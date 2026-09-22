import "server-only";

import { buildMadBuddyAdminEmailHtml } from "@/lib/email/template";
import { sendMadBuddyEmail } from "@/lib/email/send";
import { allowsBroadcastKind, emailPreferencesFromNotificationBlob } from "@/lib/email/preferences";
import type { createSupabaseAdminClient } from "@/lib/supabase/admin";

type Admin = ReturnType<typeof createSupabaseAdminClient>;

export const BROADCAST_JOB_TYPE = "communications.broadcast_email" as const;
export const BROADCAST_PAGE_SIZE = 50;

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

  for (let index = 0; index < eligible.length; index += 5) {
    const chunk = eligible.slice(index, index + 5);
    const results = await Promise.all(
      chunk.map((user) =>
        sendMadBuddyEmail({
          to: user.email!,
          subject: payload.subject,
          text,
          html,
          idempotencyKey: `broadcast/${payload.campaignId}/${user.id}`
        })
      )
    );

    for (const result of results) {
      if (result.ok) sent += 1;
      else failed += 1;
    }
  }

  const skipped = users.length - eligible.length;
  await updateJobProgress(admin, payload, { sent, failed, skipped });

  // If the provider rejected the whole eligible page, retry this page instead
  // of advancing. Successful retries remain duplicate-safe because every user
  // has a stable Resend idempotency key for this campaign.
  if (eligible.length > 0 && failed === eligible.length) {
    throw new BroadcastJobError("PROVIDER_UNAVAILABLE", "The email provider rejected the entire broadcast page.");
  }

  if (users.length === BROADCAST_PAGE_SIZE) {
    await enqueueNextPage(admin, payload);
  }

  return sent;
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
    idempotency_key: broadcastJobKey(payload.campaignId, nextPage),
    run_at: new Date().toISOString()
  });

  // A retry can race with a previously inserted continuation. The unique
  // idempotency key makes that harmless.
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
    .eq("idempotency_key", broadcastJobKey(payload.campaignId, payload.page));

  if (error) throw new BroadcastJobError("DATABASE_TIMEOUT", error.message);
}

export function broadcastJobKey(campaignId: string, page: number) {
  return `communications:${campaignId}:page:${page}`;
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
    skipped: numericCount(value.skipped)
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
