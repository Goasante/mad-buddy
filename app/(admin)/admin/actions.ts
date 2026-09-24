"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getAdminAccess, requireAdminPermission } from "@/lib/admin/access";
import { activeRestrictions, recordAdminAuditEvent, recordSensitiveAccess } from "@/lib/admin/service";
import { deliverNotification } from "@/lib/notifications/server";
import { requireSafetyAdmin } from "@/lib/safety/admin";
import { consumeRateLimit, rateLimitMessage } from "@/lib/security/rate-limit";
import { decideAccountVerification } from "@/lib/trust/verified-account-admin";

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

/**
 * Deleting an account.
 *
 * The reason is OPTIONAL in the schema and enforced per role in the action:
 * owner and admin are trusted to act without explaining themselves, support
 * must write one. Validating that here rather than in the schema keeps the
 * rule where the role is actually known.
 */
const deleteUserSchema = z.object({
  userId: z.string().uuid(),
  reason: z.string().trim().max(300).optional()
});

/**
 * A decline or a revocation must be explained; an approval need not be.
 * Refined rather than made optional, so the rule is enforced by the schema
 * rather than remembered in the action.
 */
const trustedMemberDecisionSchema = z
  .object({
    applicationId: z.string().uuid(),
    decision: z.enum(["approved", "declined", "revoked"]),
    reviewNote: z.string().trim().max(500).optional()
  })
  .refine(
    (value) => value.decision === "approved" || (value.reviewNote?.trim().length ?? 0) >= 3,
    { path: ["reviewNote"] }
  );

const accountVerificationSchema = z
  .object({
    userId: z.string().uuid(),
    // New approvals only come through reviewVerificationRequestAction, where
    // validated ID + selfie evidence are required. This legacy action remains
    // for revocation/correction of an existing result.
    decision: z.enum(["revoked", "failed"]),
    // A few words describing what was checked -- never the evidence itself,
    // which must not be stored on an identity row a reviewer can browse.
    evidenceLabel: z.string().trim().max(120).optional()
  });

const verificationRequestDecisionSchema = z.object({
  requestId: z.string().uuid(),
  decision: z.enum(["under_review", "more_information_required", "verified", "declined"]),
  note: z.string().trim().max(1000).optional()
}).refine(
  (value) => !["more_information_required", "declined"].includes(value.decision) || (value.note?.length ?? 0) >= 3,
  { path: ["note"] }
);

const verificationEvidenceSchema = z.object({
  requestId: z.string().uuid(),
  evidenceId: z.string().uuid(),
  reason: z.string().trim().min(3).max(500)
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


/**
 * Soft-delete a user account.
 *
 * SOFT, deliberately. A hard delete cascades across roughly thirty tables and
 * cannot be undone, so a mistaken tap on a real account would destroy their
 * messages, plans and friendships with no recovery. This sets `deleted_at`,
 * which every profile read already honours, and bans the auth user — so from
 * the product's point of view the account is gone immediately, while the rows
 * survive a grace period in which a mistake can still be reversed.
 *
 * The reason rule follows the role: owner and admin are not asked, support
 * must supply one. Both are recorded either way — "who deleted this account"
 * must always be answerable, and an unexplained deletion is still an
 * attributable one.
 *
 * The audit entry is written BEFORE the change, and a failure to record it
 * aborts the whole thing. That is the existing pattern for account access
 * changes here: an unlogged deletion is worse than no deletion.
 */
export async function deleteUserAccountAction(input: unknown): Promise<AdminActionState> {
  const parsed = deleteUserSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "That account is unavailable." };

  try {
    const { admin, context } = await requireSafetyAdmin();
    await requireAdminPermission(admin, context, "admin.users.delete");

    const limit = await consumeRateLimit({ action: "admin.mutate", userId: context.userId });
    if (!limit.allowed) return { ok: false, message: rateLimitMessage(limit.resetAt) };

    // Deleting yourself would revoke the access needed to undo it.
    if (parsed.data.userId === context.userId) {
      return { ok: false, message: "You cannot delete your own account." };
    }

    // Support explains; owner and admin do not have to. The role comes from
    // the canonical resolver rather than being inferred from permissions —
    // "may delete" and "must justify" are different questions.
    const { role } = await getAdminAccess(admin, context);
    const reason = parsed.data.reason?.trim() || undefined;
    const mustExplain = role === "support";
    if (mustExplain && (!reason || reason.length < 3)) {
      return { ok: false, message: "Add a short reason before deleting this account." };
    }

    const { data: target, error: targetError } = await admin.auth.admin.getUserById(parsed.data.userId);
    if (targetError || !target.user) return { ok: false, message: "That user account is unavailable." };

    const logged = await recordAdminAuditEvent(admin, {
      actorId: context.userId,
      action: "user_account_deleted",
      targetType: "user",
      targetId: parsed.data.userId,
      newState: { deleted: true, softDelete: true },
      // Absent for owner/admin, which is a truthful "not required" rather
      // than an invented justification.
      reason
    });
    if (!logged) return { ok: false, message: "The audit entry could not be recorded, so no change was made." };

    const nowIso = new Date().toISOString();
    const { error: profileError } = await admin
      .from("profiles")
      .update({ deleted_at: nowIso, updated_at: nowIso })
      .eq("user_id", parsed.data.userId);
    if (profileError) return { ok: false, message: "Couldn't delete that account. Try again." };

    // Ban the auth user too: without this the person could still sign in and
    // see an app that has erased them from everyone else's view.
    const { error: authError } = await admin.auth.admin.updateUserById(parsed.data.userId, {
      ban_duration: "876000h"
    });
    if (authError) {
      // Roll the profile back rather than leaving a half-deleted account that
      // is invisible to others but still usable by its owner.
      await admin.from("profiles").update({ deleted_at: null, updated_at: nowIso }).eq("user_id", parsed.data.userId);
      return { ok: false, message: "Couldn't revoke sign-in for that account. Nothing was changed." };
    }

    revalidatePath("/admin/users");
    return { ok: true, message: "Account deleted." };
  } catch {
    return { ok: false, message: "Admin access is required." };
  }
}

/**
 * Decide a Trusted Member application.
 *
 * Reuses `admin.verification.review`, which already exists and already means
 * "may pass judgement on an account's standing". A new permission would be a
 * second name for the same authority.
 *
 * A review note is required for a decline or a revocation and optional for an
 * approval. The asymmetry is deliberate: staff need to know why somebody was
 * turned down — especially before a second application from the same person —
 * while an approval speaks for itself. The note is never shown to the
 * applicant, who is told the outcome only.
 */
/**
 * Approves, revokes or fails an account verification.
 *
 * Kept separate from decideTrustedMemberAction on purpose: Trusted Member is
 * earned standing and Verified Account is an identity check. One action
 * covering both would be the first step towards one implying the other.
 */
export async function decideAccountVerificationAction(input: unknown): Promise<AdminActionState> {
  const parsed = accountVerificationSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: "Choose a valid verification correction." };
  }

  try {
    const { admin, context } = await requireSafetyAdmin();
    // The same permission the Trusted Member queue uses, and the one the
    // existing verification_reviewer role already grants.
    await requireAdminPermission(admin, context, "admin.verification.review");

    const limit = await consumeRateLimit({ action: "admin.mutate", userId: context.userId });
    if (!limit.allowed) return { ok: false, message: rateLimitMessage(limit.resetAt) };

    const { decideAccountVerification, getAccountVerification } = await import(
      "@/lib/trust/verified-account-admin"
    );

    // Read first, so the audit entry records what actually changed rather than
    // only where it landed.
    const previous = await getAccountVerification(admin, parsed.data.userId);

    const result = await decideAccountVerification(admin, {
      userId: parsed.data.userId,
      decision: parsed.data.decision,
      evidenceLabel: parsed.data.evidenceLabel
    });
    if (!result.ok) return { ok: false, message: result.message };

    // AFTER the write, as with Trusted Member: verification is reversible, so
    // a missing audit row must not block a correction.
    await recordAdminAuditEvent(admin, {
      actorId: context.userId,
      action: `account_verification_${parsed.data.decision}`,
      targetType: "user",
      targetId: parsed.data.userId,
      previousState: previous ? { status: previous.status } : undefined,
      newState: { status: parsed.data.decision },
      reason: parsed.data.evidenceLabel?.trim() || undefined
    });

    if (parsed.data.decision === "revoked") {
      await admin.from("verification_requests").update({
        status: "revoked",
        user_message: "Your account verification was revoked.",
        reviewed_by: context.userId,
        reviewed_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }).eq("user_id", parsed.data.userId).eq("status", "verified");
    }
    await deliverNotification(admin, {
      userId: parsed.data.userId,
      type: "system_alert",
      priority: "high",
      title: parsed.data.decision === "revoked" ? "Verification revoked" : "Verification update",
      message: parsed.data.decision === "revoked"
          ? "Your Verified Account sign has been removed."
          : "Your account was not verified."
    });

    revalidatePath("/admin/verifications");
    revalidatePath("/settings/verification");
    return { ok: true, message: result.message };
  } catch {
    return { ok: false, message: "Admin access is required." };
  }
}

export async function reviewVerificationRequestAction(input: unknown): Promise<AdminActionState> {
  const parsed = verificationRequestDecisionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Add a clear note for that decision." };

  try {
    const { admin, context } = await requireSafetyAdmin();
    await requireAdminPermission(admin, context, "admin.verification.review");
    const limit = await consumeRateLimit({ action: "admin.mutate", userId: context.userId });
    if (!limit.allowed) return { ok: false, message: rateLimitMessage(limit.resetAt) };

    const { data: request } = await admin
      .from("verification_requests")
      .select("id, user_id, status, document_type")
      .eq("id", parsed.data.requestId)
      .maybeSingle();
    if (!request) return { ok: false, message: "That verification request is unavailable." };
    if (!["pending", "under_review", "more_information_required"].includes(request.status)) {
      return { ok: false, message: "That request has already been decided." };
    }

    if (parsed.data.decision === "verified") {
      const [{ data: evidence }, restrictions] = await Promise.all([
        admin.from("verification_evidence").select("id, evidence_kind").eq("request_id", request.id).is("deleted_at", null).not("validated_at", "is", null),
        activeRestrictions(admin, request.user_id)
      ]);
      const evidenceKinds = new Set((evidence ?? []).map((item: { evidence_kind: string }) => item.evidence_kind));
      if (!evidenceKinds.has("document_front") || !evidenceKinds.has("selfie")) {
        return { ok: false, message: "The required ID and selfie evidence are not available." };
      }
      if (restrictions.length > 0) {
        return { ok: false, message: "Resolve this account's active restriction before verifying it." };
      }

      // A validated upload is not the same as a human review. Require this
      // reviewer to open both mandatory files before they can award the badge.
      const requiredEvidenceIds = (evidence ?? [])
        .filter((item: { evidence_kind: string }) => item.evidence_kind === "document_front" || item.evidence_kind === "selfie")
        .map((item: { id: string }) => item.id);
      const { data: reviewedEvidence } = await admin
        .from("sensitive_access_log")
        .select("case_reference")
        .eq("actor_id", context.userId)
        .eq("category", "verification_document")
        .in("case_reference", requiredEvidenceIds);
      const reviewedIds = new Set((reviewedEvidence ?? []).map((item) => item.case_reference));
      if (requiredEvidenceIds.some((id: string) => !reviewedIds.has(id))) {
        return { ok: false, message: "Open and review the ID and selfie before verifying this account." };
      }
    }

    const logged = await recordAdminAuditEvent(admin, {
      actorId: context.userId,
      action: `verification_request_${parsed.data.decision}`,
      targetType: "verification_request",
      targetId: request.id,
      previousState: { status: request.status },
      newState: { status: parsed.data.decision },
      reason: parsed.data.note || "Identity review"
    });
    if (!logged) return { ok: false, message: "The audit entry could not be recorded, so no change was made." };

    if (parsed.data.decision === "verified") {
      const result = await decideAccountVerification(admin, {
        userId: request.user_id,
        decision: "verified",
        evidenceLabel: `${String(request.document_type).replaceAll("_", " ")}, matched selfie`
      });
      if (!result.ok) return result;
    }

    const now = new Date().toISOString();
    const { error } = await admin.from("verification_requests").update({
      status: parsed.data.decision,
      reviewed_by: context.userId,
      reviewed_at: ["verified", "declined"].includes(parsed.data.decision) ? now : null,
      user_message: parsed.data.note || null,
      internal_note: parsed.data.note || null,
      updated_at: now
    }).eq("id", request.id);
    if (error) {
      if (parsed.data.decision === "verified") {
        await decideAccountVerification(admin, { userId: request.user_id, decision: "revoked" });
      }
      return { ok: false, message: "The verification request could not be updated." };
    }

    const notification = parsed.data.decision === "verified"
      ? { title: "Account verified", message: "Your identity verification was approved. Your Verified Account sign is now active." }
      : parsed.data.decision === "declined"
        ? { title: "Verification declined", message: parsed.data.note || "Your identity verification was not approved." }
        : parsed.data.decision === "more_information_required"
          ? { title: "Verification needs more information", message: parsed.data.note || "Open verification settings to continue." }
          : { title: "Verification review started", message: "Your identity verification is now under review." };
    await deliverNotification(admin, { userId: request.user_id, type: "system_alert", priority: "high", ...notification });

    revalidatePath("/admin/verifications");
    revalidatePath("/settings/verification");
    return { ok: true, message: "Verification request updated." };
  } catch {
    return { ok: false, message: "Admin access is required." };
  }
}

export async function openVerificationEvidenceAction(input: unknown): Promise<{ ok: boolean; message: string; url?: string }> {
  const parsed = verificationEvidenceSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Choose valid verification evidence." };
  try {
    const { admin, context } = await requireSafetyAdmin();
    await requireAdminPermission(admin, context, "admin.verification.review");
    const { data: evidence } = await admin
      .from("verification_evidence")
      .select("id, request_id, user_id, storage_path")
      .eq("id", parsed.data.evidenceId)
      .eq("request_id", parsed.data.requestId)
      .is("deleted_at", null)
      .maybeSingle();
    if (!evidence) return { ok: false, message: "That evidence is unavailable." };

    const logged = await recordSensitiveAccess(admin, {
      actorId: context.userId,
      category: "verification_document",
      subjectUserId: evidence.user_id,
      caseReference: evidence.id,
      reason: parsed.data.reason
    });
    if (!logged) return { ok: false, message: "Access could not be audited, so the file was not opened." };
    const { data, error } = await admin.storage.from("verification-evidence").createSignedUrl(evidence.storage_path, 300);
    if (error || !data) return { ok: false, message: "The evidence link could not be created." };
    return { ok: true, message: "Evidence opened for five minutes.", url: data.signedUrl };
  } catch {
    return { ok: false, message: "Admin access is required." };
  }
}

export async function decideTrustedMemberAction(input: unknown): Promise<AdminActionState> {
  const parsed = trustedMemberDecisionSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: "Add a short note before declining or revoking." };
  }

  try {
    const { admin, context } = await requireSafetyAdmin();
    await requireAdminPermission(admin, context, "admin.verification.review");

    const limit = await consumeRateLimit({ action: "admin.mutate", userId: context.userId });
    if (!limit.allowed) return { ok: false, message: rateLimitMessage(limit.resetAt) };

    const { decideTrustedMemberApplication } = await import("@/lib/trust/trusted-member-admin");
    const result = await decideTrustedMemberApplication(admin, {
      applicationId: parsed.data.applicationId,
      reviewerId: context.userId,
      decision: parsed.data.decision,
      reviewNote: parsed.data.reviewNote
    });
    if (!result.ok || !result.userId) return { ok: false, message: result.message };

    // Recorded AFTER the decision here, unlike account deletion: this is
    // reversible — a wrong approval is revoked, a wrong decline re-applied —
    // so a missing audit row must not block a correction.
    await recordAdminAuditEvent(admin, {
      actorId: context.userId,
      action: `trusted_member_${parsed.data.decision}`,
      targetType: "user",
      targetId: result.userId,
      newState: { decision: parsed.data.decision },
      reason: parsed.data.reviewNote?.trim() || undefined
    });

    revalidatePath("/admin/trusted-members");
    return { ok: true, message: "Decision recorded." };
  } catch {
    return { ok: false, message: "Admin access is required." };
  }
}
