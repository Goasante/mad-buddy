import "server-only";

import { buildMadBuddyAdminEmailHtml } from "@/lib/email/template";
import { sendMadBuddyEmail, type SendEmailResult } from "@/lib/email/send";
import { allowsBroadcastKind, emailPreferencesFromNotificationBlob } from "@/lib/email/preferences";
import type { createSupabaseAdminClient } from "@/lib/supabase/admin";

type Admin = ReturnType<typeof createSupabaseAdminClient>;

export const BROADCAST_JOB_TYPE = "communications.broadcast_email" as const;
export const BROADCAST_PAGE_SIZE = 50;
const SEND_SPACING_MS = 150;
const PROVIDER_ATTEMPTS = 3;

export type BroadcastAudience = "all_active" | "free" | "paid" | "buddy_plus" | "buddy_pro";
export type BroadcastKind = "service_notice" | "product_update" | "feature_launch" | "community_reminder";

type BroadcastPayload = {
  campaignId: string;
  campaignName: string;
  subject: string;
  message: string;
  audience: BroadcastAudience;
  kind: BroadcastKind;
  page: number;
  createdBy: string;
  sent: number;
  failed: number;
  skipped: number;
  runId?: string;
};

class BroadcastJobError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
  }
}

export async function handleBroadcastEmailJob(admin: Admin, rawPayload: Record<string, unknown>): Promise<number> {
  const payload = parsePayload(rawPayload);
  if (!payload) throw new BroadcastJobError("VALIDATION_FAILED", "Invalid broadcast email payload.");

  const { data: authPage, error: authError } = await admin.auth.admin.listUsers({
    page: payload.page,
    perPage: BROADCAST_PAGE_SIZE
  });
  if (authError) throw new BroadcastJobError("PROVIDER_UNAVAILABLE", authError.message);

  const users = authPage.users ?? [];
  if (users.length === 0) {
    await updateJobProgress(admin, payload, { sent: 0, failed: 0, skipped: 0 });
    return 0;
  }

  const userIds = users.map((user) => user.id);
  const [profilesResult, subscriptionsResult, preferencesResult] = await Promise.all([
    admin.from("profiles").select("user_id, deleted_at").in("user_id", userIds),
    admin.from("subscriptions").select("user_id, plan, status").in("user_id", userIds),
    admin.from("user_preferences").select("user_id, notification_preferences").in("user_id", userIds)
  ]);

  if (profilesResult.error) throw new BroadcastJobError("DATABASE_TIMEOUT", profilesResult.error.message);
  if (subscriptionsResult.error) throw new BroadcastJobError("DATABASE_TIMEOUT", subscriptionsResult.error.message);
  if (preferencesResult.error) throw new BroadcastJobError("DATABASE_TIMEOUT", preferencesResult.error.message);

  const activeProfiles = new Set(
    (profilesResult.data ?? []).filter((profile) => !profile.deleted_at).map((profile) => profile.user_id)
  );
  const subscriptionByUser = new Map((subscriptionsResult.data ?? []).map((subscription) => [subscription.user_id, subscription]));
  const preferencesByUser = new Map(
    (preferencesResult.data ?? []).map((row) => [row.user_id, emailPreferencesFromNotificationBlob(row.notification_preferences)])
  );

  const eligible = users.filter((user) => {
    if (!user.email || !activeProfiles.has(user.id)) return false;
    if (!matchesAudience(subscriptionByUser.get(user.id), payload.audience)) return false;
    return allowsBroadcastKind(
      preferencesByUser.get(user.id) ?? emailPreferencesFromNotificationBlob(null),
      payload.kind
    );
  });

  const preferencesUrl = "https://mad-buddy.com/settings/notifications";
  const html = buildMadBuddyAdminEmailHtml(payload.message, { managePreferencesUrl: preferencesUrl });
  const text = [
    "Mad Buddy",
    "",
    payload.message,
    "",
    "The Mad Buddy Team",
    "hello@mad-buddy.com",
    "support@mad-buddy.com",
    "mad-buddy.com",
    "",
    "When your friends are close, they glow.",
    "",
    `Manage optional email preferences: ${preferencesUrl}`
  ].join("\n");

  let sent = 0;
  let failed = 0;
  let retryableFailures = 0;

  // Send deliberately below Resend's normal API request ceiling. The previous
  // implementation fired groups of five in parallel with no pacing, which can
  // turn a healthy broadcast into a page of 429 responses.
  for (let index = 0; index < eligible.length; index += 1) {
    const user = eligible[index];
    const result = await sendRecipientWithRetry({
      to: user.email!,
      subject: payload.subject,
      text,
      html,
      idempotencyKey: `broadcast/${payload.campaignId}/${user.id}`
    });

    if (result.ok) {
      sent += 1;
    } else {
      failed += 1;
      if (isRetryableFailure(result)) retryableFailures += 1;
    }

    if (index < eligible.length - 1) await sleep(SEND_SPACING_MS);
  }

  const skipped = users.length - eligible.length;
  await updateJobProgress(admin, payload, { sent, failed, skipped });

  // Retry the page when any temporary provider/network failure survives the
  // local retries. Already-successful recipients keep the same Resend
  // idempotency key, so the queue retry does not send them twice.
  if (retryableFailures > 0) {
    throw new BroadcastJobError(
      "PROVIDER_UNAVAILABLE",
      `${retryableFailures} broadcast deliveries hit a temporary provider failure.`
    );
  }

  if (users.length === BROADCAST_PAGE_SIZE) {
    await enqueueNextPage(admin, payload);
  }

  return sent;
}

async function sendRecipientWithRetry(input: {
  to: string;
  subject: string;
  text: string;
  html: string;
  idempotencyKey: string;
}): Promise<SendEmailResult> {
  let last: SendEmailResult = { ok: false, errorCode: "resend_request_failed" };

  for (let attempt = 1; attempt <= PROVIDER_ATTEMPTS; attempt += 1) {
    last = await sendMadBuddyEmail(input);
    if (last.ok || !isRetryableFailure(last) || attempt === PROVIDER_ATTEMPTS) return last;

    const providerDelay = !last.ok ? last.retryAfterMs ?? 0 : 0;
    const backoff = Math.max(providerDelay, 500 * attempt);
    await sleep(Math.min(backoff, 5_000));
  }

  return last;
}

function isRetryableFailure(result: SendEmailResult) {
  if (result.ok) return false;
  if (result.errorCode === "resend_request_failed" || result.errorCode === "concurrent_idempotent_requests") return true;
  if (result.httpStatus === 429) return true;
  return typeof result.httpStatus === "number" && result.httpStatus >= 500;
}

async function enqueueNextPage(admin: Admin, payload: BroadcastPayload) {
  const nextPage = payload.page + 1;
  const nextPayload: BroadcastPayload = {
    ...payload,
    page: nextPage,
    sent: 0,
    failed: 0,
    skipped: 0
  };

  const { error } = await admin.from("jobs").insert({
    job_type: BROADCAST_JOB_TYPE,
    payload: nextPayload,
    priority: 4,
    status: "queued",
    max_attempts: 5,
    idempotency_key: broadcastJobKey(payload.campaignId, nextPage, payload.runId),
    run_at: new Date().toISOString()
  });

  if (error && error.code !== "23505") {
    throw new BroadcastJobError("DATABASE_TIMEOUT", error.message);
  }
}

async function updateJobProgress(
  admin: Admin,
  payload: BroadcastPayload,
  counts: { sent: number; failed: number; skipped: number }
) {
  const nextPayload: BroadcastPayload = { ...payload, ...counts };
  const { error } = await admin
    .from("jobs")
    .update({ payload: nextPayload })
    .eq("idempotency_key", broadcastJobKey(payload.campaignId, payload.page, payload.runId));

  if (error) throw new BroadcastJobError("DATABASE_TIMEOUT", error.message);
}

export function broadcastJobKey(campaignId: string, page: number, runId?: string) {
  return runId
    ? `communications:${campaignId}:run:${runId}:page:${page}`
    : `communications:${campaignId}:page:${page}`;
}

function matchesAudience(
  subscription: { plan: string; status: string } | undefined,
  audience: BroadcastAudience
) {
  const activePremium = Boolean(
    subscription &&
      (subscription.status === "active" || subscription.status === "trialing") &&
      (subscription.plan === "buddy_plus" || subscription.plan === "buddy_pro")
  );

  if (audience === "all_active") return true;
  if (audience === "free") return !activePremium;
  if (audience === "paid") return activePremium;
  if (audience === "buddy_plus") return activePremium && subscription?.plan === "buddy_plus";
  if (audience === "buddy_pro") return activePremium && subscription?.plan === "buddy_pro";
  return false;
}

function parsePayload(value: Record<string, unknown>): BroadcastPayload | null {
  const audienceValues: BroadcastAudience[] = ["all_active", "free", "paid", "buddy_plus", "buddy_pro"];
  const kindValues: BroadcastKind[] = ["service_notice", "product_update", "feature_launch", "community_reminder"];

  const campaignId = stringValue(value.campaignId, 80);
  const campaignName = stringValue(value.campaignName, 80);
  const subject = stringValue(value.subject, 120);
  const message = stringValue(value.message, 5000);
  const createdBy = stringValue(value.createdBy, 80);
  const runId = value.runId === undefined ? undefined : stringValue(value.runId, 80) ?? undefined;
  const audience = value.audience;
  const kind = value.kind;
  const page = typeof value.page === "number" && Number.isInteger(value.page) && value.page >= 1 ? value.page : null;

  if (
    !campaignId ||
    !campaignName ||
    !subject ||
    !message ||
    !createdBy ||
    !page ||
    typeof audience !== "string" ||
    !audienceValues.includes(audience as BroadcastAudience) ||
    typeof kind !== "string" ||
    !kindValues.includes(kind as BroadcastKind)
  ) {
    return null;
  }

  return {
    campaignId,
    campaignName,
    subject,
    message,
    createdBy,
    audience: audience as BroadcastAudience,
    kind: kind as BroadcastKind,
    page,
    sent: numericCount(value.sent),
    failed: numericCount(value.failed),
    skipped: numericCount(value.skipped),
    ...(runId ? { runId } : {})
  };
}

function stringValue(value: unknown, max: number) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed && trimmed.length <= max ? trimmed : null;
}

function numericCount(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
