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

    const text = buildPlainText(parsed.data.message);
    const result = await sendMadBuddyEmail({
      to: recipient,
      subject: `[Test] ${parsed.data.subject}`,
      text,
      html: buildMadBuddyAdminEmailHtml(parsed.data.message),
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
