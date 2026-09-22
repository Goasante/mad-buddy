"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdminPermission } from "@/lib/admin/access";
import { recordAdminAuditEvent } from "@/lib/admin/service";
import {
  BROADCAST_JOB_TYPE,
  broadcastJobKey,
  type BroadcastAudience,
  type BroadcastKind
} from "@/lib/communications/broadcast";
import { sendMadBuddyEmail } from "@/lib/email/send";
import { buildMadBuddyAdminEmailHtml } from "@/lib/email/template";
import { requireSafetyAdmin } from "@/lib/safety/admin";
import { consumeRateLimit, rateLimitMessage } from "@/lib/security/rate-limit";

export type AdminCommunicationState = { ok: boolean; message: string };

const BROADCAST_RETRY_WINDOW_MS = 20 * 60 * 60 * 1000;
const audienceSchema = z.enum(["all_active", "free", "paid", "buddy_plus", "buddy_pro"]);
const kindSchema = z.enum(["service_notice", "product_update", "feature_launch", "community_reminder"]);

const campaignSchema = z.object({
  campaignName: z.string().trim().min(2).max(80),
  subject: z.string().trim().min(2).max(120),
  message: z.string().trim().min(2).max(5000),
  audience: audienceSchema,
  kind: kindSchema,
  requestId: z.string().uuid(),
  confirmation: z.literal("SEND")
});

const testSchema = z.object({
  campaignName: z.string().trim().min(2).max(80),
  subject: z.string().trim().min(2).max(120),
  message: z.string().trim().min(2).max(5000),
  audience: audienceSchema,
  kind: kindSchema,
  requestId: z.string().uuid()
});

const retrySchema = z.object({ campaignId: z.string().uuid() });

export async function queueBroadcastCommunicationAction(input: unknown): Promise<AdminCommunicationState> {
  const parsed = campaignSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: "Complete the campaign fields and type SEND to confirm." };
  }

  try {
    const { admin, context } = await requireSafetyAdmin();
    await requireAdminPermission(admin, context, "admin.support.manage");

    const limit = await consumeRateLimit({ action: "admin.mutate", userId: context.userId });
    if (!limit.allowed) return { ok: false, message: rateLimitMessage(limit.resetAt) };

    const campaignId = parsed.data.requestId;
    const auditRecorded = await recordAdminAuditEvent(admin, {
      actorId: context.userId,
      action: "admin_broadcast_email_queued",
      targetType: "communications_campaign",
      targetId: campaignId,
      newState: {
        channel: "email",
        provider: "resend",
        audience: parsed.data.audience,
        kind: parsed.data.kind,
        campaignName: parsed.data.campaignName,
        subjectLength: parsed.data.subject.length,
        messageLength: parsed.data.message.length,
        campaignId
      },
      reason: "Admin mass communication"
    });

    if (!auditRecorded) {
      return { ok: false, message: "The audit entry could not be recorded, so the campaign was not queued." };
    }

    const payload = {
      campaignId,
      campaignName: parsed.data.campaignName,
      subject: parsed.data.subject,
      message: parsed.data.message,
      audience: parsed.data.audience as BroadcastAudience,
      kind: parsed.data.kind as BroadcastKind,
      page: 1,
      createdBy: context.userId,
      sent: 0,
      failed: 0,
      skipped: 0
    };

    const { error } = await admin.from("jobs").insert({
      job_type: BROADCAST_JOB_TYPE,
      payload,
      priority: 4,
      status: "queued",
      max_attempts: 5,
      idempotency_key: broadcastJobKey(campaignId, 1),
      run_at: new Date().toISOString()
    });

    if (error && error.code !== "23505") {
      return { ok: false, message: "The campaign could not be queued. Try again." };
    }

    revalidatePath("/admin/communications");
    return {
      ok: true,
      message: error?.code === "23505" ? "This campaign is already queued." : "Campaign queued for background delivery."
    };
  } catch {
    return { ok: false, message: "You don't have permission to send mass communications." };
  }
}

export async function sendCommunicationTestAction(input: unknown): Promise<AdminCommunicationState> {
  const parsed = testSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Add a campaign name, subject, and message first." };

  try {
    const { admin, context } = await requireSafetyAdmin();
    await requireAdminPermission(admin, context, "admin.support.manage");

    const limit = await consumeRateLimit({ action: "admin.mutate", userId: context.userId });
    if (!limit.allowed) return { ok: false, message: rateLimitMessage(limit.resetAt) };

    const { data, error } = await admin.auth.admin.getUserById(context.userId);
    const recipient = data.user?.email;
    if (error || !recipient) return { ok: false, message: "Your admin account does not have an email address available." };

    const testNotice = "TEST PREVIEW — sent only to your admin account. No users received this preview.";
    const previewMessage = `${testNotice}\n\n${parsed.data.message}`;
    const text = buildPlainText(previewMessage);
    const result = await sendMadBuddyEmail({
      to: recipient,
      subject: `TEST ONLY — ${parsed.data.subject}`,
      text,
      html: buildMadBuddyAdminEmailHtml(previewMessage),
      idempotencyKey: `communications-test/${context.userId}/${parsed.data.requestId}`
    });

    if (!result.ok) return { ok: false, message: "The test email could not be sent." };

    await recordAdminAuditEvent(admin, {
      actorId: context.userId,
      action: "admin_broadcast_email_test_sent",
      targetType: "communications_campaign",
      targetId: parsed.data.requestId,
      newState: {
        channel: "email",
        provider: "resend",
        kind: parsed.data.kind,
        audience: parsed.data.audience,
        providerMessageId: result.providerMessageId
      },
      reason: "Admin mass communication test"
    });

    return {
      ok: true,
      message: `Test sent only to ${recipient}. No broadcast was queued.`
    };
  } catch {
    return { ok: false, message: "You don't have permission to send communication tests." };
  }
}

export async function retryBroadcastCommunicationAction(input: unknown): Promise<AdminCommunicationState> {
  const parsed = retrySchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "That broadcast could not be identified." };

  try {
    const { admin, context } = await requireSafetyAdmin();
    await requireAdminPermission(admin, context, "admin.support.manage");

    const limit = await consumeRateLimit({ action: "admin.mutate", userId: context.userId });
    if (!limit.allowed) return { ok: false, message: rateLimitMessage(limit.resetAt) };

    const { data: rows, error } = await admin
      .from("jobs")
      .select("payload, status, created_at")
      .eq("job_type", BROADCAST_JOB_TYPE)
      .order("created_at", { ascending: false })
      .limit(1000);
    if (error) return { ok: false, message: "Broadcast history could not be loaded." };

    const campaignRows = (rows ?? []).filter((row) => {
      const payload = objectPayload(row.payload);
      return payload?.campaignId === parsed.data.campaignId;
    });
    if (campaignRows.length === 0) return { ok: false, message: "That broadcast could not be found." };

    if (campaignRows.some((row) => ["queued", "scheduled", "processing", "retrying"].includes(row.status))) {
      return { ok: false, message: "This broadcast already has delivery work in progress." };
    }

    const originalCreatedAt = campaignRows.reduce(
      (oldest, row) => Math.min(oldest, Date.parse(row.created_at)),
      Number.POSITIVE_INFINITY
    );
    if (!Number.isFinite(originalCreatedAt) || Date.now() - originalCreatedAt > BROADCAST_RETRY_WINDOW_MS) {
      return {
        ok: false,
        message: "The safe retry window has passed. Do not resend the whole campaign, because that could duplicate emails already delivered."
      };
    }

    const latestByPage = new Map<number, (typeof campaignRows)[number]>();
    for (const row of campaignRows) {
      const payload = objectPayload(row.payload);
      const page = numericCount(payload?.page);
      if (page >= 1 && !latestByPage.has(page)) latestByPage.set(page, row);
    }
    const currentFailed = [...latestByPage.values()].reduce((sum, row) => {
      const payload = objectPayload(row.payload);
      return sum + numericCount(payload?.failed);
    }, 0);
    if (currentFailed === 0) return { ok: false, message: "This broadcast has no failed deliveries to retry." };

    const sourceRow = campaignRows.find((row) => numericCount(objectPayload(row.payload)?.page) === 1);
    const source = objectPayload(sourceRow?.payload);
    if (!source) return { ok: false, message: "The original campaign payload is unavailable." };

    const sourceAudience = audienceSchema.safeParse(source.audience);
    const sourceKind = kindSchema.safeParse(source.kind);
    const campaignName = stringValue(source.campaignName, 80);
    const subject = stringValue(source.subject, 120);
    const message = stringValue(source.message, 5000);
    const createdBy = stringValue(source.createdBy, 80);
    if (!sourceAudience.success || !sourceKind.success || !campaignName || !subject || !message || !createdBy) {
      return { ok: false, message: "The original campaign payload is incomplete." };
    }

    const runId = crypto.randomUUID();
    const auditRecorded = await recordAdminAuditEvent(admin, {
      actorId: context.userId,
      action: "admin_broadcast_email_retry_queued",
      targetType: "communications_campaign",
      targetId: parsed.data.campaignId,
      newState: { runId, previousFailed: currentFailed },
      reason: "Retry failed mass-email deliveries within Resend idempotency window"
    });
    if (!auditRecorded) {
      return { ok: false, message: "The audit entry could not be recorded, so the retry was not queued." };
    }

    const retryPayload = {
      campaignId: parsed.data.campaignId,
      campaignName,
      subject,
      message,
      audience: sourceAudience.data as BroadcastAudience,
      kind: sourceKind.data as BroadcastKind,
      page: 1,
      createdBy,
      sent: 0,
      failed: 0,
      skipped: 0,
      runId
    };
    const { error: insertError } = await admin.from("jobs").insert({
      job_type: BROADCAST_JOB_TYPE,
      payload: retryPayload,
      priority: 4,
      status: "queued",
      max_attempts: 5,
      idempotency_key: broadcastJobKey(parsed.data.campaignId, 1, runId),
      run_at: new Date().toISOString()
    });
    if (insertError) return { ok: false, message: "The failed deliveries could not be queued for retry." };

    revalidatePath("/admin/communications");
    return {
      ok: true,
      message: "Failed deliveries queued for safe retry. Previously successful recipients will not be sent the campaign again."
    };
  } catch {
    return { ok: false, message: "You don't have permission to retry broadcasts." };
  }
}

function buildPlainText(message: string) {
  return [
    "Mad Buddy",
    "",
    message,
    "",
    "The Mad Buddy Team",
    "hello@mad-buddy.com",
    "support@mad-buddy.com",
    "mad-buddy.com",
    "",
    "When your friends are close, they glow."
  ].join("\n");
}

function objectPayload(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function stringValue(value: unknown, max: number) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed && trimmed.length <= max ? trimmed : null;
}

function numericCount(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
}
