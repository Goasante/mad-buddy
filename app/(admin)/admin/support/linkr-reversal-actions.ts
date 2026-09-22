"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdminPermission } from "@/lib/admin/access";
import { recordAdminAuditEvent } from "@/lib/admin/service";
import { deliverNotification } from "@/lib/notifications/server";
import { requireSafetyAdmin } from "@/lib/safety/admin";
import { consumeRateLimit, rateLimitMessage } from "@/lib/security/rate-limit";
import { isBlockedEitherDirection } from "@/lib/social/permissions";

export type LinkrReversalReviewState = { ok: boolean; message: string };

const reviewSchema = z.object({
  ticketId: z.string().uuid(),
  decision: z.enum(["approve", "reject"])
});

function diagnosticsObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export async function reviewLinkrPassReversalAction(input: unknown): Promise<LinkrReversalReviewState> {
  const parsed = reviewSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "That rewind request could not be identified." };

  try {
    const { admin, context } = await requireSafetyAdmin();
    await requireAdminPermission(admin, context, "admin.support.manage");

    const limit = await consumeRateLimit({ action: "admin.mutate", userId: context.userId });
    if (!limit.allowed) return { ok: false, message: rateLimitMessage(limit.resetAt) };

    const { data: ticket, error: ticketError } = await admin
      .from("support_tickets")
      .select("id, user_id, status, diagnostics")
      .eq("id", parsed.data.ticketId)
      .maybeSingle();

    if (ticketError || !ticket?.user_id) return { ok: false, message: "That support request is no longer available." };
    if (ticket.status === "resolved" || ticket.status === "closed") {
      return { ok: false, message: "This rewind request has already been reviewed." };
    }

    const diagnostics = diagnosticsObject(ticket.diagnostics);
    const targetUserId = typeof diagnostics.target_user_id === "string" ? diagnostics.target_user_id : "";
    if (diagnostics.workflow !== "linkr_pass_reversal" || !z.string().uuid().safeParse(targetUserId).success) {
      return { ok: false, message: "This support issue is not a Linkr rewind request." };
    }

    const approved = parsed.data.decision === "approve";
    let activePassId: string | null = null;

    if (approved) {
      // Safety always outranks recovery. Admin cannot use a rewind ticket to
      // route around a block that either person placed after the pass.
      if (await isBlockedEitherDirection(admin, ticket.user_id, targetUserId)) {
        return { ok: false, message: "This profile cannot be restored while a block is active." };
      }

      const { data: pass, error: passError } = await admin
        .from("linkr_actions")
        .select("id, expires_at")
        .eq("actor_id", ticket.user_id)
        .eq("target_id", targetUserId)
        .eq("action", "pass")
        .not("expires_at", "is", null)
        .gt("expires_at", new Date().toISOString())
        .maybeSingle();
      if (passError) return { ok: false, message: "The current Linkr pass could not be verified." };
      activePassId = pass?.id ?? null;
    }

    const logged = await recordAdminAuditEvent(admin, {
      actorId: context.userId,
      action: approved ? "linkr_pass_reversal_approved" : "linkr_pass_reversal_rejected",
      targetType: "support_ticket",
      targetId: ticket.id,
      newState: { targetUserId, decision: parsed.data.decision, activePass: Boolean(activePassId) },
      reason: "Admin review of canonical Linkr rewind request"
    });
    if (!logged) return { ok: false, message: "The audit entry could not be recorded, so nothing was changed." };

    if (approved && activePassId) {
      const { error: deleteError } = await admin
        .from("linkr_actions")
        .delete()
        .eq("id", activePassId)
        .eq("actor_id", ticket.user_id)
        .eq("action", "pass");
      if (deleteError) return { ok: false, message: "The Linkr pass could not be restored." };
    }

    const resolvedAt = new Date().toISOString();
    const { error: ticketUpdateError } = await admin
      .from("support_tickets")
      .update({ status: "resolved", resolved_at: resolvedAt })
      .eq("id", ticket.id);
    if (ticketUpdateError) return { ok: false, message: "The review was applied, but the support issue could not be closed." };

    await admin.from("support_ticket_events").insert({
      ticket_id: ticket.id,
      actor_id: context.userId,
      event_type: "status_changed",
      from_value: ticket.status,
      to_value: "resolved",
      note: approved ? "Linkr rewind approved" : "Linkr rewind rejected"
    });

    await deliverNotification(admin, {
      userId: ticket.user_id,
      type: "system_alert",
      title: approved ? "Your Linkr rewind was approved" : "Your Linkr rewind was reviewed",
      message: approved
        ? activePassId
          ? "That passed profile is eligible to appear in Linkr again. No connection was created automatically."
          : "That pass had already expired or been cleared, so the profile was already eligible to appear again."
        : "The pass stays in place for now and will still expire automatically after its normal 30-day window."
    });

    revalidatePath("/admin/support");
    revalidatePath(`/admin/support/${ticket.id}`);
    return {
      ok: true,
      message: approved
        ? activePassId
          ? "Linkr rewind approved and the pass was removed."
          : "Linkr rewind approved; the pass was already inactive."
        : "Linkr rewind request rejected."
    };
  } catch {
    return { ok: false, message: "Admin access is required to review Linkr rewinds." };
  }
}
