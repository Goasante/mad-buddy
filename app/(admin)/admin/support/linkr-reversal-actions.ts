"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdminPermission } from "@/lib/admin/access";
import { recordAdminAuditEvent } from "@/lib/admin/service";
import { deliverNotification } from "@/lib/notifications/server";
import { requireSafetyAdmin } from "@/lib/safety/admin";
import { consumeRateLimit, rateLimitMessage } from "@/lib/security/rate-limit";

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
    const workflow = diagnostics.workflow;
    if (workflow !== "linkr_pass_reversal" || !z.string().uuid().safeParse(targetUserId).success) {
      return { ok: false, message: "This support issue is not a Linkr rewind request." };
    }

    const approved = parsed.data.decision === "approve";
    const logged = await recordAdminAuditEvent(admin, {
      actorId: context.userId,
      action: approved ? "linkr_pass_reversal_approved" : "linkr_pass_reversal_rejected",
      targetType: "support_ticket",
      targetId: ticket.id,
      newState: { targetUserId, decision: parsed.data.decision },
      reason: "Admin review of Linkr rewind request"
    });
    if (!logged) return { ok: false, message: "The audit entry could not be recorded, so nothing was changed." };

    if (approved) {
      const { error: deleteError } = await admin
        .from("discovery_passes")
        .delete()
        .eq("user_id", ticket.user_id)
        .eq("passed_user_id", targetUserId);
      if (deleteError) return { ok: false, message: "The Linkr pass could not be restored." };

      // If the skipped person had privately expressed Linkr interest, passing
      // temporarily closes that interest. Restoring the pass makes that same
      // private interest eligible again; it still does not create a match.
      await admin
        .from("friend_requests")
        .update({ status: "pending", responded_at: null })
        .eq("sender_id", targetUserId)
        .eq("receiver_id", ticket.user_id)
        .eq("context_type", "socialize")
        .eq("status", "declined")
        .gte("responded_at", new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString());
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
        ? "That skipped profile can appear in Linkr again. No connection was created automatically."
        : "The skip stays in place for now. It will still expire automatically after its normal 30-day window."
    });

    revalidatePath("/admin/support");
    revalidatePath(`/admin/support/${ticket.id}`);
    return {
      ok: true,
      message: approved ? "Linkr rewind approved and the profile was restored." : "Linkr rewind request rejected."
    };
  } catch {
    return { ok: false, message: "Admin access is required to review Linkr rewinds." };
  }
}
