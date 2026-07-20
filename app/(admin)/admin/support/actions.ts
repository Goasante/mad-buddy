"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdminPermission } from "@/lib/admin/access";
import { recordAdminAuditEvent } from "@/lib/admin/service";
import { deliverNotification } from "@/lib/notifications/server";
import { requireSafetyAdmin } from "@/lib/safety/admin";
import { consumeRateLimit, rateLimitMessage } from "@/lib/security/rate-limit";
import type { Database } from "@/lib/supabase/database.types";
import {
  canTransitionStatus,
  isReopen,
  isTerminalStatus,
  priorityLabel,
  priorityRequiresReason,
  SUPPORT_PRIORITIES,
  SUPPORT_STATUSES,
  statusLabel,
  type SupportPriority,
  type SupportStatus
} from "@/lib/admin/support";

export type SupportActionState = { ok: boolean; message: string };

// A response/note is treated as a duplicate submission when an identical body
// lands on the same ticket within this window. Prevents double-clicks and
// retried transitions from creating two records (spec: idempotency).
const DUPLICATE_WINDOW_MS = 15_000;

type Admin = Awaited<ReturnType<typeof requireSafetyAdmin>>["admin"];
type TicketEventType =
  Database["public"]["Tables"]["support_ticket_events"]["Insert"]["event_type"];

/**
 * Shared guard for every support mutation: resolve the acting user from the
 * server session, re-check admin.support.manage, and consume the rate limit.
 * Returns null-shaped failure so callers can early-return a safe message.
 */
async function authorizeSupportMutation() {
  const { admin, context } = await requireSafetyAdmin();
  await requireAdminPermission(admin, context, "admin.support.manage");
  const limit = await consumeRateLimit({ action: "admin.mutate", userId: context.userId });
  if (!limit.allowed) {
    return { ok: false as const, message: rateLimitMessage(limit.resetAt) };
  }
  return { ok: true as const, admin, actorId: context.userId };
}

async function recordTicketEvent(
  admin: Admin,
  input: {
    ticketId: string;
    actorId: string;
    eventType: TicketEventType;
    fromValue?: string | null;
    toValue?: string | null;
    note?: string | null;
  }
) {
  await admin.from("support_ticket_events").insert({
    ticket_id: input.ticketId,
    actor_id: input.actorId,
    event_type: input.eventType,
    from_value: input.fromValue ?? null,
    to_value: input.toValue ?? null,
    note: input.note ?? null
  });
}

function revalidateIssue(ticketId: string) {
  revalidatePath("/admin/support");
  revalidatePath(`/admin/support/${ticketId}`);
}

// ---------------------------------------------------------------------------
// Assignment
// ---------------------------------------------------------------------------
const assignSchema = z.object({
  ticketId: z.string().uuid(),
  // null → unassign.
  assigneeId: z.string().uuid().nullable(),
  reason: z.string().trim().max(280).optional()
});

export async function assignSupportIssueAction(input: unknown): Promise<SupportActionState> {
  const parsed = assignSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Choose a valid issue and assignee." };

  let admin: Admin;
  let actorId: string;
  try {
    const auth = await authorizeSupportMutation();
    if (!auth.ok) return auth;
    admin = auth.admin;
    actorId = auth.actorId;
  } catch {
    return { ok: false, message: "Admin access is required." };
  }

  const { ticketId, assigneeId, reason } = parsed.data;

  const { data: ticket, error: ticketError } = await admin
    .from("support_tickets")
    .select("id, assigned_to, subject")
    .eq("id", ticketId)
    .maybeSingle();
  if (ticketError || !ticket) return { ok: false, message: "That issue is unavailable." };

  // Validate the assignee is active staff (owner/admin/support). Never assign to
  // a standard user, an inactive staff record, or a deleted account.
  if (assigneeId) {
    const { data: staff } = await admin
      .from("admin_users")
      .select("role, disabled_at, auth_user_id")
      .eq("auth_user_id", assigneeId)
      .maybeSingle();
    const eligible = staff && !staff.disabled_at && ["owner", "admin", "support"].includes(staff.role);
    if (!eligible) {
      await recordAdminAuditEvent(admin, {
        actorId,
        action: "support_issue_assign_denied",
        targetType: "support_ticket",
        targetId: ticketId,
        newState: { assigneeId },
        reason: "ineligible_assignee"
      });
      return { ok: false, message: "You can only assign to active Admin or Support staff." };
    }
  }

  if (ticket.assigned_to === assigneeId) {
    return { ok: true, message: assigneeId ? "Already assigned to that person." : "Already unassigned." };
  }

  const isTransfer = Boolean(ticket.assigned_to && assigneeId);
  const eventType = !assigneeId ? "unassigned" : isTransfer ? "transferred" : "assigned";
  const action = !assigneeId
    ? "support_issue_unassigned"
    : isTransfer
      ? "support_issue_transferred"
      : "support_issue_assigned";

  const logged = await recordAdminAuditEvent(admin, {
    actorId,
    action,
    targetType: "support_ticket",
    targetId: ticketId,
    previousState: { assignedTo: ticket.assigned_to },
    newState: { assignedTo: assigneeId },
    reason: reason || "Support assignment"
  });
  if (!logged) return { ok: false, message: "The audit entry could not be recorded, so no change was made." };

  const { error } = await admin.from("support_tickets").update({ assigned_to: assigneeId }).eq("id", ticketId);
  if (error) return { ok: false, message: "Couldn't update the assignment." };

  await recordTicketEvent(admin, {
    ticketId,
    actorId,
    eventType,
    fromValue: ticket.assigned_to,
    toValue: assigneeId,
    note: reason || null
  });

  // Notify the new assignee (internal staff notification only).
  if (assigneeId && assigneeId !== actorId) {
    await deliverNotification(admin, {
      userId: assigneeId,
      type: "system_alert",
      priority: "high",
      title: isTransfer ? "A support issue was transferred to you" : "A support issue was assigned to you",
      message: ticket.subject
    });
  }

  revalidateIssue(ticketId);
  return { ok: true, message: !assigneeId ? "Issue unassigned." : isTransfer ? "Issue transferred." : "Issue assigned." };
}

// ---------------------------------------------------------------------------
// Status workflow
// ---------------------------------------------------------------------------
const statusSchema = z.object({
  ticketId: z.string().uuid(),
  status: z.enum(SUPPORT_STATUSES),
  reason: z.string().trim().max(280).optional()
});

export async function updateSupportIssueStatusAction(input: unknown): Promise<SupportActionState> {
  const parsed = statusSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Choose a valid status." };

  let admin: Admin;
  let actorId: string;
  try {
    const auth = await authorizeSupportMutation();
    if (!auth.ok) return auth;
    admin = auth.admin;
    actorId = auth.actorId;
  } catch {
    return { ok: false, message: "Admin access is required." };
  }

  const { ticketId, status, reason } = parsed.data;

  const { data: ticket, error: ticketError } = await admin
    .from("support_tickets")
    .select("id, status, assigned_to")
    .eq("id", ticketId)
    .maybeSingle();
  if (ticketError || !ticket) return { ok: false, message: "That issue is unavailable." };

  const from = ticket.status as SupportStatus;
  if (!canTransitionStatus(from, status)) {
    await recordAdminAuditEvent(admin, {
      actorId,
      action: "support_issue_status_denied",
      targetType: "support_ticket",
      targetId: ticketId,
      previousState: { status: from },
      newState: { status },
      reason: "invalid_transition"
    });
    return { ok: false, message: `You can't move ${statusLabel(from)} to ${statusLabel(status)}.` };
  }

  const reopened = isReopen(from, status);
  const logged = await recordAdminAuditEvent(admin, {
    actorId,
    action: reopened ? "support_issue_reopened" : "support_issue_status_changed",
    targetType: "support_ticket",
    targetId: ticketId,
    previousState: { status: from },
    newState: { status },
    reason: reason || "Support status workflow"
  });
  if (!logged) return { ok: false, message: "The audit entry could not be recorded, so no change was made." };

  // Terminal statuses stamp resolved_at; leaving a terminal state clears it.
  const { error } = await admin
    .from("support_tickets")
    .update({ status, resolved_at: isTerminalStatus(status) ? new Date().toISOString() : null })
    .eq("id", ticketId);
  if (error) return { ok: false, message: "Couldn't update the status." };

  await recordTicketEvent(admin, {
    ticketId,
    actorId,
    eventType: reopened ? "reopened" : "status_changed",
    fromValue: from,
    toValue: status,
    note: reason || null
  });

  // Reopening pings the assignee so a resolved-then-reopened issue isn't missed.
  if (reopened && ticket.assigned_to && ticket.assigned_to !== actorId) {
    await deliverNotification(admin, {
      userId: ticket.assigned_to,
      type: "system_alert",
      priority: "high",
      title: "A support issue was reopened",
      message: "An issue assigned to you needs another look."
    });
  }

  revalidateIssue(ticketId);
  return { ok: true, message: reopened ? "Issue reopened." : "Status updated." };
}

// ---------------------------------------------------------------------------
// Priority workflow
// ---------------------------------------------------------------------------
const prioritySchema = z.object({
  ticketId: z.string().uuid(),
  priority: z.enum(SUPPORT_PRIORITIES),
  reason: z.string().trim().max(280).optional()
});

export async function updateSupportIssuePriorityAction(input: unknown): Promise<SupportActionState> {
  const parsed = prioritySchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Choose a valid priority." };

  const { ticketId, priority, reason } = parsed.data;

  // Critical requires a written reason (enforced server-side, not just in the UI).
  if (priorityRequiresReason(priority as SupportPriority) && (!reason || reason.length < 3)) {
    return { ok: false, message: "Add a short reason before setting Critical priority." };
  }

  let admin: Admin;
  let actorId: string;
  try {
    const auth = await authorizeSupportMutation();
    if (!auth.ok) return auth;
    admin = auth.admin;
    actorId = auth.actorId;
  } catch {
    return { ok: false, message: "Admin access is required." };
  }

  const { data: ticket, error: ticketError } = await admin
    .from("support_tickets")
    .select("id, priority, assigned_to")
    .eq("id", ticketId)
    .maybeSingle();
  if (ticketError || !ticket) return { ok: false, message: "That issue is unavailable." };

  const from = ticket.priority as SupportPriority;
  if (from === priority) return { ok: true, message: "Priority unchanged." };

  const logged = await recordAdminAuditEvent(admin, {
    actorId,
    action: "support_issue_priority_changed",
    targetType: "support_ticket",
    targetId: ticketId,
    previousState: { priority: from },
    newState: { priority },
    reason: reason || "Support priority workflow"
  });
  if (!logged) return { ok: false, message: "The audit entry could not be recorded, so no change was made." };

  const { error } = await admin.from("support_tickets").update({ priority }).eq("id", ticketId);
  if (error) return { ok: false, message: "Couldn't update the priority." };

  await recordTicketEvent(admin, {
    ticketId,
    actorId,
    eventType: "priority_changed",
    fromValue: from,
    toValue: priority,
    note: reason || null
  });

  // Escalation to Critical pings the assignee.
  if (priority === "urgent" && ticket.assigned_to && ticket.assigned_to !== actorId) {
    await deliverNotification(admin, {
      userId: ticket.assigned_to,
      type: "system_alert",
      priority: "high",
      title: "A support issue was escalated to Critical",
      message: "An issue assigned to you was raised to Critical priority."
    });
  }

  revalidateIssue(ticketId);
  return { ok: true, message: `Priority set to ${priorityLabel(priority)}.` };
}

// ---------------------------------------------------------------------------
// Public response (to the user) — a real support message + user notification.
// ---------------------------------------------------------------------------
const publicResponseSchema = z.object({
  ticketId: z.string().uuid(),
  body: z.string().trim().min(2).max(5000)
});

export async function sendPublicResponseAction(input: unknown): Promise<SupportActionState> {
  const parsed = publicResponseSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Write a response between 2 and 5,000 characters." };

  let admin: Admin;
  let actorId: string;
  try {
    const auth = await authorizeSupportMutation();
    if (!auth.ok) return auth;
    admin = auth.admin;
    actorId = auth.actorId;
  } catch {
    return { ok: false, message: "Admin access is required." };
  }

  const { ticketId, body } = parsed.data;

  const { data: ticket, error: ticketError } = await admin
    .from("support_tickets")
    .select("id, user_id, status, assigned_to")
    .eq("id", ticketId)
    .maybeSingle();
  if (ticketError || !ticket) return { ok: false, message: "That issue is unavailable." };

  // Idempotency: an identical response on this ticket within the window is a
  // duplicate submission, not a second message.
  const since = new Date(Date.now() - DUPLICATE_WINDOW_MS).toISOString();
  const { data: recent } = await admin
    .from("support_ticket_messages")
    .select("id, message")
    .eq("ticket_id", ticketId)
    .eq("sender_type", "agent")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(1);
  if (recent && recent[0]?.message === body) {
    return { ok: true, message: "Response sent." };
  }

  // Audit first (no response body stored twice — record only a safe summary).
  const logged = await recordAdminAuditEvent(admin, {
    actorId,
    action: "support_public_response_sent",
    targetType: "support_ticket",
    targetId: ticketId,
    newState: { affectedUserId: ticket.user_id, length: body.length },
    reason: "Customer support response"
  });
  if (!logged) return { ok: false, message: "The audit entry could not be recorded, so the response was not sent." };

  const { error: messageError } = await admin.from("support_ticket_messages").insert({
    ticket_id: ticketId,
    sender_type: "agent",
    sender_id: actorId,
    message: body
  });
  if (messageError) return { ok: false, message: "Couldn't send that response. Try again." };

  // Sending a response moves the issue to waiting-for-user and claims it if
  // unassigned — but never auto-resolves it.
  await admin
    .from("support_tickets")
    .update({
      status: ticket.status === "closed" ? ticket.status : "waiting_on_user",
      assigned_to: ticket.assigned_to ?? actorId
    })
    .eq("id", ticketId);

  await recordTicketEvent(admin, { ticketId, actorId, eventType: "response_sent", toValue: null });

  // Real user-facing notification (never includes internal notes/diagnostics).
  if (ticket.user_id) {
    await deliverNotification(admin, {
      userId: ticket.user_id,
      type: "system_alert",
      priority: "high",
      title: "Support replied to your issue",
      message: body.length > 140 ? `${body.slice(0, 137)}…` : body
    });
  }

  revalidateIssue(ticketId);
  return { ok: true, message: "Response sent." };
}

// ---------------------------------------------------------------------------
// Internal note (staff-only) — never notifies the user, never leaves Admin.
// ---------------------------------------------------------------------------
const internalNoteSchema = z.object({
  ticketId: z.string().uuid(),
  body: z.string().trim().min(2).max(5000)
});

export async function addInternalNoteAction(input: unknown): Promise<SupportActionState> {
  const parsed = internalNoteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Write a note between 2 and 5,000 characters." };

  let admin: Admin;
  let actorId: string;
  try {
    const auth = await authorizeSupportMutation();
    if (!auth.ok) return auth;
    admin = auth.admin;
    actorId = auth.actorId;
  } catch {
    return { ok: false, message: "Admin access is required." };
  }

  const { ticketId, body } = parsed.data;

  const { data: ticket, error: ticketError } = await admin
    .from("support_tickets")
    .select("id")
    .eq("id", ticketId)
    .maybeSingle();
  if (ticketError || !ticket) return { ok: false, message: "That issue is unavailable." };

  // Idempotency: identical note within the window is a duplicate submission.
  const since = new Date(Date.now() - DUPLICATE_WINDOW_MS).toISOString();
  const { data: recent } = await admin
    .from("support_internal_notes")
    .select("id, body")
    .eq("ticket_id", ticketId)
    .eq("author_id", actorId)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(1);
  if (recent && recent[0]?.body === body) {
    return { ok: true, message: "Note added." };
  }

  const logged = await recordAdminAuditEvent(admin, {
    actorId,
    action: "support_internal_note_added",
    targetType: "support_ticket",
    targetId: ticketId,
    newState: { length: body.length },
    reason: "Internal support note"
  });
  if (!logged) return { ok: false, message: "The audit entry could not be recorded, so the note was not saved." };

  const { error } = await admin.from("support_internal_notes").insert({
    ticket_id: ticketId,
    author_id: actorId,
    body
  });
  if (error) return { ok: false, message: "Couldn't save that note." };

  await recordTicketEvent(admin, { ticketId, actorId, eventType: "note_added", toValue: null });

  revalidateIssue(ticketId);
  return { ok: true, message: "Note added." };
}
