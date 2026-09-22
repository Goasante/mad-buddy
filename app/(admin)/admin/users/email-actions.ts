"use server";

import { z } from "zod";
import { requireAdminPermission } from "@/lib/admin/access";
import { recordAdminAuditEvent } from "@/lib/admin/service";
import { sendMadBuddyEmail } from "@/lib/email/send";
import { requireSafetyAdmin } from "@/lib/safety/admin";
import { consumeRateLimit, rateLimitMessage } from "@/lib/security/rate-limit";

export type AdminUserEmailState = { ok: boolean; message: string };

const adminUserEmailSchema = z.object({
  userId: z.string().uuid(),
  subject: z.string().trim().min(2).max(120),
  message: z.string().trim().min(2).max(5000),
  requestId: z.string().uuid()
});

export async function sendAdminUserEmailAction(input: unknown): Promise<AdminUserEmailState> {
  const parsed = adminUserEmailSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: "Add a subject and message before sending." };
  }

  try {
    const { admin, context } = await requireSafetyAdmin();
    await requireAdminPermission(admin, context, "admin.support.manage");

    const limit = await consumeRateLimit({ action: "admin.mutate", userId: context.userId });
    if (!limit.allowed) return { ok: false, message: rateLimitMessage(limit.resetAt) };

    const [{ data: profile }, { data: target, error: targetError }] = await Promise.all([
      admin
        .from("profiles")
        .select("user_id, deleted_at")
        .eq("user_id", parsed.data.userId)
        .maybeSingle(),
      admin.auth.admin.getUserById(parsed.data.userId)
    ]);

    if (!profile || profile.deleted_at || targetError || !target.user?.email) {
      return { ok: false, message: "That user account does not have an available registered email." };
    }

    const requestLogged = await recordAdminAuditEvent(admin, {
      actorId: context.userId,
      action: "admin_email_send_requested",
      targetType: "user",
      targetId: parsed.data.userId,
      newState: {
        channel: "email",
        provider: "resend",
        delivery: "registered_email",
        subjectLength: parsed.data.subject.length,
        messageLength: parsed.data.message.length,
        requestId: parsed.data.requestId
      },
      reason: "Direct admin email"
    });

    if (!requestLogged) {
      return { ok: false, message: "The audit entry could not be recorded, so no email was sent." };
    }

    const result = await sendMadBuddyEmail({
      to: target.user.email,
      subject: parsed.data.subject,
      text: `Mad Buddy\n\n${parsed.data.message}\n\nWhen your friends are close, they glow.`,
      idempotencyKey: `admin-email/${context.userId}/${parsed.data.requestId}`
    });

    if (!result.ok) {
      await recordAdminAuditEvent(admin, {
        actorId: context.userId,
        action: "admin_email_send_failed",
        targetType: "user",
        targetId: parsed.data.userId,
        newState: {
          channel: "email",
          provider: "resend",
          requestId: parsed.data.requestId,
          errorCode: result.errorCode
        },
        reason: "Direct admin email"
      });
      return { ok: false, message: "The email could not be sent. Try again later." };
    }

    await recordAdminAuditEvent(admin, {
      actorId: context.userId,
      action: "admin_email_sent",
      targetType: "user",
      targetId: parsed.data.userId,
      newState: {
        channel: "email",
        provider: "resend",
        providerMessageId: result.providerMessageId,
        requestId: parsed.data.requestId
      },
      reason: "Direct admin email"
    });

    return { ok: true, message: "Email sent to the user's registered email." };
  } catch {
    return { ok: false, message: "You don't have permission to email users." };
  }
}
