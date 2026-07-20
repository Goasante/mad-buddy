"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdminPermission } from "@/lib/admin/access";
import { recordAdminAuditEvent } from "@/lib/admin/service";
import { deliverNotification } from "@/lib/notifications/server";
import { requireSafetyAdmin } from "@/lib/safety/admin";
import { consumeRateLimit, rateLimitMessage } from "@/lib/security/rate-limit";

export type AdminActionState = { ok: boolean; message: string };

const supportStatusSchema = z.object({
  ticketId: z.string().uuid(),
  status: z.enum(["new", "open", "waiting_on_user", "waiting_on_internal_team", "resolved", "closed", "escalated"])
});

const privacyStatusSchema = z.object({
  requestId: z.string().uuid(),
  status: z.enum(["submitted", "verified", "processing", "completed", "rejected", "on_legal_hold"])
});

const supportReplySchema = z.object({
  ticketId: z.string().uuid(),
  message: z.string().trim().min(2).max(2000)
});

const userAccessSchema = z.object({
  userId: z.string().uuid(),
  disabled: z.boolean(),
  reason: z.string().trim().min(3).max(300)
});

const quickFixSchema = z.object({
  userId: z.string().uuid(),
  fix: z.enum(["pause_visibility", "clear_notification_badge", "reset_glow_signal"]),
  reason: z.string().trim().min(3).max(300)
});

export async function updateSupportTicketStatusAction(input: unknown): Promise<AdminActionState> {
  const parsed = supportStatusSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Choose a valid ticket status." };

  try {
    const { admin, context } = await requireSafetyAdmin();
    await requireAdminPermission(admin, context, "admin.support.manage");
    const limit = await consumeRateLimit({ action: "admin.mutate", userId: context.userId });
    if (!limit.allowed) return { ok: false, message: rateLimitMessage(limit.resetAt) };
    const { data: ticket, error: ticketError } = await admin
      .from("support_tickets")
      .select("status")
      .eq("id", parsed.data.ticketId)
      .maybeSingle();
    if (ticketError || !ticket) return { ok: false, message: "That support ticket is unavailable." };

    const logged = await recordAdminAuditEvent(admin, {
      actorId: context.userId,
      action: "support_ticket_status_changed",
      targetType: "support_ticket",
      targetId: parsed.data.ticketId,
      previousState: { status: ticket.status },
      newState: { status: parsed.data.status },
      reason: "Support queue workflow"
    });
    if (!logged) return { ok: false, message: "The audit entry could not be recorded, so no change was made." };

    const terminal = parsed.data.status === "resolved" || parsed.data.status === "closed";
    const { error } = await admin
      .from("support_tickets")
      .update({ status: parsed.data.status, resolved_at: terminal ? new Date().toISOString() : null })
      .eq("id", parsed.data.ticketId);
    if (error) return { ok: false, message: "Couldn't update that support ticket." };

    revalidatePath("/admin");
    revalidatePath("/admin/support");
    return { ok: true, message: "Ticket updated." };
  } catch {
    return { ok: false, message: "Admin access is required." };
  }
}

export async function updatePrivacyRequestStatusAction(input: unknown): Promise<AdminActionState> {
  const parsed = privacyStatusSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Choose a valid request status." };

  try {
    const { admin, context } = await requireSafetyAdmin();
    await requireAdminPermission(admin, context, "admin.privacy.requests.manage");
    const limit = await consumeRateLimit({ action: "admin.mutate", userId: context.userId });
    if (!limit.allowed) return { ok: false, message: rateLimitMessage(limit.resetAt) };
    const { data: request, error: requestError } = await admin
      .from("privacy_requests")
      .select("status, verified_at")
      .eq("id", parsed.data.requestId)
      .maybeSingle();
    if (requestError || !request) return { ok: false, message: "That privacy request is unavailable." };

    const logged = await recordAdminAuditEvent(admin, {
      actorId: context.userId,
      action: "privacy_request_status_changed",
      targetType: "privacy_request",
      targetId: parsed.data.requestId,
      previousState: { status: request.status },
      newState: { status: parsed.data.status },
      reason: "Privacy request workflow"
    });
    if (!logged) return { ok: false, message: "The audit entry could not be recorded, so no change was made." };

    const now = new Date().toISOString();
    const update: {
      status: typeof parsed.data.status;
      verified_at?: string;
      completed_at: string | null;
    } = {
      status: parsed.data.status,
      completed_at: parsed.data.status === "completed" ? now : null
    };
    if (parsed.data.status === "verified" && !request.verified_at) update.verified_at = now;
    const { error } = await admin
      .from("privacy_requests")
      .update(update)
      .eq("id", parsed.data.requestId);
    if (error) return { ok: false, message: "Couldn't update that privacy request." };

    revalidatePath("/admin");
    revalidatePath("/admin/privacy");
    return { ok: true, message: "Privacy request updated." };
  } catch {
    return { ok: false, message: "Admin access is required." };
  }
}

export async function replyToSupportTicketAction(input: unknown): Promise<AdminActionState> {
  const parsed = supportReplySchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Write a reply between 2 and 2,000 characters." };

  try {
    const { admin, context } = await requireSafetyAdmin();
    await requireAdminPermission(admin, context, "admin.support.manage");
    const limit = await consumeRateLimit({ action: "admin.mutate", userId: context.userId });
    if (!limit.allowed) return { ok: false, message: rateLimitMessage(limit.resetAt) };
    const { data: ticket, error: ticketError } = await admin
      .from("support_tickets")
      .select("user_id, status")
      .eq("id", parsed.data.ticketId)
      .maybeSingle();
    if (ticketError || !ticket) return { ok: false, message: "That support ticket is unavailable." };

    const logged = await recordAdminAuditEvent(admin, {
      actorId: context.userId,
      action: "support_reply_sent",
      targetType: "support_ticket",
      targetId: parsed.data.ticketId,
      previousState: { status: ticket.status },
      newState: { status: "waiting_on_user" },
      reason: "Customer support response"
    });
    if (!logged) return { ok: false, message: "The audit entry could not be recorded, so the reply was not sent." };

    const { error: messageError } = await admin.from("support_ticket_messages").insert({
      ticket_id: parsed.data.ticketId,
      sender_type: "agent",
      sender_id: context.userId,
      message: parsed.data.message
    });
    if (messageError) return { ok: false, message: "Couldn't save that reply." };

    await admin.from("support_tickets").update({
      status: "waiting_on_user",
      assigned_to: context.userId,
      resolved_at: null
    }).eq("id", parsed.data.ticketId);

    if (ticket.user_id) {
      await deliverNotification(admin, {
        userId: ticket.user_id,
        type: "system_alert",
        priority: "high",
        title: "Support replied",
        message: parsed.data.message
      });
    }

    revalidatePath("/admin");
    revalidatePath("/admin/support");
    return { ok: true, message: "Reply sent." };
  } catch {
    return { ok: false, message: "Admin access is required." };
  }
}

export async function setUserAccessAction(input: unknown): Promise<AdminActionState> {
  const parsed = userAccessSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Add a short reason before changing access." };

  try {
    const { admin, context } = await requireSafetyAdmin();
    await requireAdminPermission(admin, context, "admin.users.suspend");
    const limit = await consumeRateLimit({ action: "admin.mutate", userId: context.userId });
    if (!limit.allowed) return { ok: false, message: rateLimitMessage(limit.resetAt) };
    if (parsed.data.userId === context.userId) return { ok: false, message: "You cannot disable your own account." };

    const { data: target, error: targetError } = await admin.auth.admin.getUserById(parsed.data.userId);
    if (targetError || !target.user) return { ok: false, message: "That user account is unavailable." };

    const logged = await recordAdminAuditEvent(admin, {
      actorId: context.userId,
      action: parsed.data.disabled ? "user_account_disabled" : "user_account_enabled",
      targetType: "user",
      targetId: parsed.data.userId,
      newState: { disabled: parsed.data.disabled },
      reason: parsed.data.reason
    });
    if (!logged) return { ok: false, message: "The audit entry could not be recorded, so no change was made." };

    const { error: authError } = await admin.auth.admin.updateUserById(parsed.data.userId, {
      ban_duration: parsed.data.disabled ? "876000h" : "none"
    });
    if (authError) return { ok: false, message: "Couldn't update authentication access." };

    if (parsed.data.disabled) {
      const { data: existing } = await admin.from("user_restrictions")
        .select("id")
        .eq("user_id", parsed.data.userId)
        .eq("restriction_type", "suspended_permanent")
        .is("lifted_at", null)
        .maybeSingle();
      if (!existing) {
        const { error } = await admin.from("user_restrictions").insert({
          user_id: parsed.data.userId,
          restriction_type: "suspended_permanent",
          reason_code: parsed.data.reason
        });
        if (error) {
          await admin.auth.admin.updateUserById(parsed.data.userId, { ban_duration: "none" });
          return { ok: false, message: "Couldn't save the account restriction." };
        }
      }
    } else {
      const { error } = await admin.from("user_restrictions").update({
        lifted_at: new Date().toISOString()
      }).eq("user_id", parsed.data.userId).in("restriction_type", ["suspended_temporary", "suspended_permanent"]).is("lifted_at", null);
      if (error) return { ok: false, message: "Authentication was restored, but the restriction could not be cleared." };
    }

    revalidatePath("/admin/users");
    return { ok: true, message: parsed.data.disabled ? "User account disabled." : "User account enabled." };
  } catch {
    return { ok: false, message: "Admin access is required." };
  }
}

export async function runUserQuickFixAction(input: unknown): Promise<AdminActionState> {
  const parsed = quickFixSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Choose a valid fix and add a short reason." };

  try {
    const { admin, context } = await requireSafetyAdmin();
    await requireAdminPermission(admin, context, "admin.support.manage");
    const limit = await consumeRateLimit({ action: "admin.mutate", userId: context.userId });
    if (!limit.allowed) return { ok: false, message: rateLimitMessage(limit.resetAt) };
    const actionByFix = {
      pause_visibility: "support_pause_visibility",
      clear_notification_badge: "support_clear_notification_badge",
      reset_glow_signal: "support_reset_glow_signal"
    } as const;
    const logged = await recordAdminAuditEvent(admin, {
      actorId: context.userId,
      action: actionByFix[parsed.data.fix],
      targetType: "user",
      targetId: parsed.data.userId,
      reason: parsed.data.reason
    });
    if (!logged) return { ok: false, message: "The audit entry could not be recorded, so no change was made." };

    if (parsed.data.fix === "pause_visibility") {
      const { error } = await admin.from("profiles").update({ visibility_status: "ghost" }).eq("user_id", parsed.data.userId);
      if (error) return { ok: false, message: "Couldn't pause visibility." };
    }
    if (parsed.data.fix === "clear_notification_badge") {
      const { error } = await admin.from("notifications").update({ is_read: true }).eq("user_id", parsed.data.userId).eq("is_read", false);
      if (error) return { ok: false, message: "Couldn't clear the notification badge." };
    }
    if (parsed.data.fix === "reset_glow_signal") {
      const { error } = await admin.from("user_locations").delete().eq("user_id", parsed.data.userId);
      if (error) return { ok: false, message: "Couldn't reset the glow signal." };
    }

    revalidatePath("/admin/users");
    return { ok: true, message: "Quick fix completed." };
  } catch {
    return { ok: false, message: "Admin access is required." };
  }
}
