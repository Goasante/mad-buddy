"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getAdminAccess, requireAdminPermission } from "@/lib/admin/access";
import { recordAdminAuditEvent } from "@/lib/admin/service";
import { deliverNotification } from "@/lib/notifications/server";
import { requireSafetyAdmin } from "@/lib/safety/admin";
import { consumeRateLimit, rateLimitMessage } from "@/lib/security/rate-limit";
import { backfillProfileForAuthUser } from "@/lib/admin/orphan-accounts";
import { absoluteUrl } from "@/lib/seo";
import { setTrustedMemberRecognition } from "@/lib/trust/trusted-member-admin";

export type CreateProfileState = { ok: boolean; message: string };

const schema = z.object({ userId: z.string().uuid() });
const passwordResetSchema = z.object({
  userId: z.string().uuid(),
  reason: z.string().trim().min(3).max(300),
  ticketId: z.string().uuid().optional()
});
const trustedMemberSchema = z.object({
  userId: z.string().uuid(),
  trusted: z.boolean(),
  reason: z.string().trim().min(3).max(500)
});

export type PasswordResetState = { ok: boolean; message: string };
export type TrustedMemberRecognitionState = { ok: boolean; message: string };

export async function setTrustedMemberRecognitionAction(
  input: unknown
): Promise<TrustedMemberRecognitionState> {
  const parsed = trustedMemberSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Add a short reason for this decision." };

  try {
    const { admin, context } = await requireSafetyAdmin();
    await requireAdminPermission(admin, context, "admin.verification.review");
    if (parsed.data.userId === context.userId) {
      return { ok: false, message: "Staff cannot grant or remove their own Trusted Member badge." };
    }
    const limit = await consumeRateLimit({ action: "admin.mutate", userId: context.userId });
    if (!limit.allowed) return { ok: false, message: rateLimitMessage(limit.resetAt) };

    const result = await setTrustedMemberRecognition(admin, {
      userId: parsed.data.userId,
      reviewerId: context.userId,
      trusted: parsed.data.trusted,
      reason: parsed.data.reason
    });
    if (!result.ok) return { ok: false, message: result.message };
    if (!result.changed) return { ok: true, message: result.message };

    await recordAdminAuditEvent(admin, {
      actorId: context.userId,
      action: parsed.data.trusted ? "trusted_member_staff_granted" : "trusted_member_staff_revoked",
      targetType: "user",
      targetId: parsed.data.userId,
      newState: { trustedMember: parsed.data.trusted },
      reason: parsed.data.reason
    });

    await deliverNotification(admin, {
      userId: parsed.data.userId,
      type: "system_alert",
      priority: "high",
      title: parsed.data.trusted ? "Trusted Member badge granted" : "Trusted Member badge removed",
      message: parsed.data.trusted
        ? "Mad Buddy has recognised you as a Trusted Member."
        : "Your Trusted Member badge has been removed. Contact support if you have questions."
    });

    revalidatePath("/admin/users");
    revalidatePath("/admin/trusted-members");
    revalidatePath("/profile");
    revalidatePath("/friends", "layout");
    return { ok: true, message: result.message };
  } catch {
    return { ok: false, message: "You don't have permission to manage Trusted Member badges." };
  }
}

/**
 * Sends Supabase's standard recovery email. Staff never receive or set the
 * password, and no email address is returned to the client or written to the
 * audit log. Active staff accounts stay on self-service recovery so a support
 * agent cannot target a more privileged account through the user console.
 */
export async function sendUserPasswordResetAction(input: unknown): Promise<PasswordResetState> {
  const parsed = passwordResetSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Add a short reason before sending the reset link." };

  try {
    const { admin, context } = await requireSafetyAdmin();
    await requireAdminPermission(admin, context, "admin.users.recovery_link");
    const limit = await consumeRateLimit({ action: "admin.password_reset", userId: context.userId });
    if (!limit.allowed) return { ok: false, message: rateLimitMessage(limit.resetAt) };

    const [{ data: profile }, { data: staffAccount }, { data: target, error: targetError }] = await Promise.all([
      admin.from("profiles").select("user_id, deleted_at").eq("user_id", parsed.data.userId).maybeSingle(),
      admin
        .from("admin_users")
        .select("auth_user_id")
        .eq("auth_user_id", parsed.data.userId)
        .is("disabled_at", null)
        .maybeSingle(),
      admin.auth.admin.getUserById(parsed.data.userId)
    ]);

    if (!profile || profile.deleted_at || targetError || !target.user?.email) {
      return { ok: false, message: "That user account is unavailable." };
    }
    if (staffAccount) {
      return { ok: false, message: "Staff accounts must use the normal Forgot password flow." };
    }
    if (parsed.data.ticketId) {
      const { data: ticket } = await admin
        .from("support_tickets")
        .select("user_id")
        .eq("id", parsed.data.ticketId)
        .maybeSingle();
      if (!ticket || ticket.user_id !== parsed.data.userId) {
        return { ok: false, message: "That support ticket does not belong to this account." };
      }
    }

    const logged = await recordAdminAuditEvent(admin, {
      actorId: context.userId,
      action: "user_password_reset_link_requested",
      targetType: "user",
      targetId: parsed.data.userId,
      caseReference: parsed.data.ticketId,
      newState: { delivery: "registered_email" },
      reason: parsed.data.reason
    });
    if (!logged) return { ok: false, message: "The audit entry could not be recorded, so no email was sent." };

    const { error } = await admin.auth.resetPasswordForEmail(target.user.email, {
      redirectTo: absoluteUrl("/auth/callback?next=/reset-password")
    });
    if (error) return { ok: false, message: "The password reset email could not be sent. Try again later." };

    await deliverNotification(admin, {
      userId: parsed.data.userId,
      type: "system_alert",
      priority: "high",
      title: "Password reset requested",
      message: "A secure password reset link was sent to your registered email. If you did not request it, contact support."
    });

    return { ok: true, message: "Password reset link sent to the user's registered email." };
  } catch {
    return { ok: false, message: "You don't have permission to send password reset links." };
  }
}

/**
 * Backfill the missing `profiles` row for an auth account surfaced by the
 * orphan-accounts safeguard. Same guards as any repair: session-resolved actor,
 * per-permission check, rate limit, and audit-first (an unlogged repair is worse
 * than a failed one).
 */
export async function createMissingProfileAction(input: unknown): Promise<CreateProfileState> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Choose a valid account." };

  try {
    const { admin, context } = await requireSafetyAdmin();
    await requireAdminPermission(admin, context, "admin.support.manage");
    const limit = await consumeRateLimit({ action: "admin.mutate", userId: context.userId });
    if (!limit.allowed) return { ok: false, message: rateLimitMessage(limit.resetAt) };

    const logged = await recordAdminAuditEvent(admin, {
      actorId: context.userId,
      action: "repair:create_missing_profile",
      targetType: "user",
      targetId: parsed.data.userId,
      newState: { reason: "Backfill profile for auth account with no profile row" },
      reason: "Backfill missing profile row"
    });
    if (!logged) return { ok: false, message: "The audit entry could not be recorded, so no change was made." };

    const result = await backfillProfileForAuthUser(admin, parsed.data.userId);
    if (result.ok) revalidatePath("/admin/users");
    return result;
  } catch {
    return { ok: false, message: "You don't have permission to do this." };
  }
}

// ---------------------------------------------------------------------------
// Direct staff message — a one-way, non-replyable notification sent to a user.
// The sender's tier decides the tag: support → "Support", owner/admin →
// "Mad Buddy core team". Gated on admin.support.manage (all three tiers have it).
// ---------------------------------------------------------------------------
export type StaffMessageState = { ok: boolean; message: string };

const staffMessageSchema = z.object({
  userId: z.string().uuid(),
  message: z.string().trim().min(2).max(1000)
});

export async function sendStaffMessageAction(input: unknown): Promise<StaffMessageState> {
  const parsed = staffMessageSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Write a message (2–1000 characters)." };

  try {
    const { admin, context } = await requireSafetyAdmin();
    await requireAdminPermission(admin, context, "admin.support.manage");
    const access = await getAdminAccess(admin, context);
    const limit = await consumeRateLimit({ action: "admin.mutate", userId: context.userId });
    if (!limit.allowed) return { ok: false, message: rateLimitMessage(limit.resetAt) };

    const { data: profile } = await admin
      .from("profiles")
      .select("user_id, deleted_at")
      .eq("user_id", parsed.data.userId)
      .maybeSingle();
    if (!profile || profile.deleted_at) return { ok: false, message: "That account is unavailable." };

    const isSupport = access.role === "support";
    const tag = isSupport ? "Support" : "Mad Buddy core team";
    const type = isSupport ? "staff_message:support" : "staff_message:core_team";

    const logged = await recordAdminAuditEvent(admin, {
      actorId: context.userId,
      action: "staff_message_sent",
      targetType: "user",
      targetId: parsed.data.userId,
      newState: { tag, length: parsed.data.message.length },
      reason: "Direct staff message"
    });
    if (!logged) return { ok: false, message: "The audit entry could not be recorded, so nothing was sent." };

    // Appears in the user's Pulse as a high-priority notification. It carries no
    // reply affordance (not a meetup_request / conversation), so it's one-way.
    await deliverNotification(admin, {
      userId: parsed.data.userId,
      senderId: context.userId,
      type,
      priority: "high",
      title: tag,
      message: parsed.data.message.trim()
    });

    return { ok: true, message: `Message sent as “${tag}”.` };
  } catch {
    return { ok: false, message: "You don't have permission to message users." };
  }
}
