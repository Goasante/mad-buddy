"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdminPermission } from "@/lib/admin/access";
import { activeRestrictions, applyUserRestriction, recordAdminAuditEvent } from "@/lib/admin/service";
import { restrictionNotice } from "@/lib/admin/governance";
import { deliverNotification } from "@/lib/notifications/server";
import { requireSafetyAdmin } from "@/lib/safety/admin";
import { consumeRateLimit, rateLimitMessage } from "@/lib/security/rate-limit";
import type { Database } from "@/lib/supabase/database.types";
import {
  canTransitionReport,
  isTerminalReportStatus,
  MODERATION_ACTION_TYPES,
  moderationActionToRestriction,
  moderationRequiresReason,
  moderationTakesDuration,
  reportStatusLabel,
  type ReportKind
} from "@/lib/admin/moderation";

export type ModerationActionState = { ok: boolean; message: string };

type Admin = Awaited<ReturnType<typeof requireSafetyAdmin>>["admin"];

/** Resolve actor, re-check admin.reports.review, and consume the rate limit. */
async function authorizeModeration() {
  const { admin, context } = await requireSafetyAdmin();
  await requireAdminPermission(admin, context, "admin.reports.review");
  const limit = await consumeRateLimit({ action: "admin.mutate", userId: context.userId });
  if (!limit.allowed) return { ok: false as const, message: rateLimitMessage(limit.resetAt) };
  return { ok: true as const, admin, actorId: context.userId };
}

async function loadReport(admin: Admin, kind: ReportKind, reportId: string) {
  if (kind === "content") {
    const { data } = await admin
      .from("content_reports")
      .select("id, reported_user_id, content_type, content_id, status")
      .eq("id", reportId)
      .maybeSingle();
    return data
      ? { id: data.id, reportedUserId: data.reported_user_id, status: data.status, contentType: data.content_type }
      : null;
  }
  const { data } = await admin
    .from("reports")
    .select("id, reporter_id, reported_user_id, status")
    .eq("id", reportId)
    .maybeSingle();
  return data
    ? { id: data.id, reportedUserId: data.reported_user_id, reporterId: data.reporter_id, status: data.status, contentType: null }
    : null;
}

type ContentReportStatus = NonNullable<Database["public"]["Tables"]["content_reports"]["Row"]["status"]>;
type UserReportStatusDb = NonNullable<Database["public"]["Tables"]["reports"]["Row"]["status"]>;

async function setStatus(admin: Admin, kind: ReportKind, reportId: string, status: string) {
  if (kind === "content") {
    return admin
      .from("content_reports")
      .update({ status: status as ContentReportStatus, resolved_at: isTerminalReportStatus(status) ? new Date().toISOString() : null })
      .eq("id", reportId);
  }
  return admin.from("reports").update({ status: status as UserReportStatusDb }).eq("id", reportId);
}

function revalidateReports(kind: ReportKind, reportId: string) {
  revalidatePath("/admin/reports");
  revalidatePath(`/admin/reports/${kind}/${reportId}`);
}

// ---------------------------------------------------------------------------
// Status workflow
// ---------------------------------------------------------------------------
const statusSchema = z.object({
  kind: z.enum(["user", "content"]),
  reportId: z.string().uuid(),
  status: z.string().min(1),
  reason: z.string().trim().max(280).optional()
});

export async function setReportStatusAction(input: unknown): Promise<ModerationActionState> {
  const parsed = statusSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Choose a valid report status." };
  const { kind, reportId, status, reason } = parsed.data;

  let admin: Admin;
  let actorId: string;
  try {
    const auth = await authorizeModeration();
    if (!auth.ok) return auth;
    admin = auth.admin;
    actorId = auth.actorId;
  } catch {
    return { ok: false, message: "Admin access is required." };
  }

  const report = await loadReport(admin, kind, reportId);
  if (!report) return { ok: false, message: "That report is unavailable." };

  if (!canTransitionReport(kind, report.status, status)) {
    await recordAdminAuditEvent(admin, {
      actorId,
      action: "report_status_denied",
      targetType: kind === "content" ? "content_report" : "report",
      targetId: reportId,
      previousState: { status: report.status },
      newState: { status },
      reason: "invalid_transition"
    });
    return {
      ok: false,
      message: `You can't move ${reportStatusLabel(kind, report.status)} to ${reportStatusLabel(kind, status)}.`
    };
  }

  const logged = await recordAdminAuditEvent(admin, {
    actorId,
    action: "report_status_changed",
    targetType: kind === "content" ? "content_report" : "report",
    targetId: reportId,
    previousState: { status: report.status },
    newState: { status },
    reason: reason || "Trust and safety review"
  });
  if (!logged) return { ok: false, message: "The audit entry could not be recorded, so no change was made." };

  const { error } = await setStatus(admin, kind, reportId, status);
  if (error) return { ok: false, message: "The report status could not be updated." };

  revalidateReports(kind, reportId);
  return { ok: true, message: "Report status updated." };
}

// ---------------------------------------------------------------------------
// Moderation action (content ops + enforcement via applyUserRestriction)
// ---------------------------------------------------------------------------
const actionSchema = z.object({
  kind: z.enum(["user", "content"]),
  reportId: z.string().uuid(),
  actionType: z.enum(MODERATION_ACTION_TYPES),
  reason: z.string().trim().max(500).optional(),
  durationHours: z.number().int().min(1).max(8760).optional()
});

export async function applyModerationActionAction(input: unknown): Promise<ModerationActionState> {
  const parsed = actionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Choose a valid moderation action." };
  const { kind, reportId, actionType, reason, durationHours } = parsed.data;

  // Reason / duration requirements are enforced server-side, not just in the UI.
  if (moderationRequiresReason(actionType) && (!reason || reason.length < 3)) {
    return { ok: false, message: "Add a short reason for this action." };
  }
  if (moderationTakesDuration(actionType) && !durationHours) {
    return { ok: false, message: "Set how long the temporary suspension should last." };
  }

  let admin: Admin;
  let actorId: string;
  try {
    const auth = await authorizeModeration();
    if (!auth.ok) return auth;
    admin = auth.admin;
    actorId = auth.actorId;
  } catch {
    return { ok: false, message: "Admin access is required." };
  }

  const report = await loadReport(admin, kind, reportId);
  if (!report) return { ok: false, message: "That report is unavailable." };

  const restriction = moderationActionToRestriction(actionType);

  // Audit-first: record the moderation decision before doing anything.
  const logged = await recordAdminAuditEvent(admin, {
    actorId,
    action: "moderation_action",
    targetType: kind === "content" ? "content_report" : "report",
    targetId: reportId,
    newState: { actionType, restriction, targetUserId: report.reportedUserId ?? null },
    reason: reason || "Trust and safety action"
  });
  if (!logged) return { ok: false, message: "The audit entry could not be recorded, so no action was taken." };

  // Enforcement actions apply a restriction through the existing permission-
  // checked, audited service — never an inline update.
  if (restriction) {
    if (!report.reportedUserId) {
      return { ok: false, message: "The reported account is no longer available, so it can't be restricted." };
    }
    // Idempotent: don't stack an identical active restriction.
    const current = await activeRestrictions(admin, report.reportedUserId);
    if (!current.includes(restriction)) {
      const endsAtMs = moderationTakesDuration(actionType) && durationHours ? Date.now() + durationHours * 3_600_000 : null;
      const result = await applyUserRestriction(admin, {
        actorId,
        userId: report.reportedUserId,
        restriction,
        reasonCode: reason || "moderation",
        endsAtMs
      });
      if (!result.ok) return result; // surfaces permission / write failures
      const endsAtIso = endsAtMs ? new Date(endsAtMs).toISOString().slice(0, 10) : null;
      await deliverNotification(admin, {
        userId: report.reportedUserId,
        type: "system_alert",
        priority: "high",
        title: "Account update",
        message: restrictionNotice(restriction, endsAtIso)
      });
    }
  }

  // Content reports record every action in moderation_actions (the FK targets
  // content_reports only). User reports rely on the audit + restriction trail.
  if (kind === "content") {
    await admin.from("moderation_actions").insert({
      report_id: reportId,
      moderator_id: actorId,
      action_type: actionType,
      reason: reason || null
    });
  }

  // Resulting report status: no_action dismisses, escalate keeps it in review,
  // everything else resolves/actions the report.
  const nextStatus =
    kind === "content"
      ? actionType === "no_action"
        ? "dismissed"
        : actionType === "escalate"
          ? "under_review"
          : "actioned"
      : actionType === "no_action"
        ? "dismissed"
        : actionType === "escalate"
          ? "reviewing"
          : "resolved";
  if (nextStatus !== report.status) {
    await setStatus(admin, kind, reportId, nextStatus);
  }

  // Let the reporter know their report was reviewed (no internal detail).
  const reporterId = "reporterId" in report ? report.reporterId : null;
  if (reporterId && reporterId !== actorId) {
    await deliverNotification(admin, {
      userId: reporterId,
      type: "system_alert",
      priority: "normal",
      title: "Report reviewed",
      message: "Thanks for your report. Our team has reviewed it and taken any action we found appropriate."
    });
  }

  revalidateReports(kind, reportId);
  return { ok: true, message: restriction ? "Action applied and enforcement recorded." : "Action recorded." };
}
