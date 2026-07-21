/**
 * Reports & moderation domain logic (Admin slice).
 *
 * Pure, server-agnostic helpers shared by the server actions (which enforce
 * them) and the Admin UI (which mirrors them). Machine values REUSE the
 * canonical CHECK constraints on public.reports, public.content_reports, and
 * public.moderation_actions, and the restriction ladder from governance — no
 * competing model is introduced. Only human-facing labels and the
 * action→restriction mapping live here.
 */

import { RESTRICTION_LADDER, restrictionSeverity, type RestrictionType } from "@/lib/admin/governance";

export type ReportKind = "user" | "content";

// --- User reports (public.reports, report_status enum) --------------------
export const USER_REPORT_STATUSES = ["open", "reviewing", "resolved", "dismissed"] as const;
export type UserReportStatus = (typeof USER_REPORT_STATUSES)[number];

export const USER_REPORT_STATUS_LABELS: Record<UserReportStatus, string> = {
  open: "Open",
  reviewing: "Reviewing",
  resolved: "Resolved",
  dismissed: "Dismissed"
};

const USER_REPORT_TRANSITIONS: Record<UserReportStatus, readonly UserReportStatus[]> = {
  open: ["reviewing", "resolved", "dismissed"],
  reviewing: ["resolved", "dismissed"],
  resolved: ["reviewing"],
  dismissed: ["reviewing"]
};

// --- Content reports (public.content_reports) -----------------------------
export const CONTENT_REPORT_STATUSES = ["received", "under_review", "actioned", "dismissed"] as const;
export type ContentReportStatus = (typeof CONTENT_REPORT_STATUSES)[number];

export const CONTENT_REPORT_STATUS_LABELS: Record<ContentReportStatus, string> = {
  received: "Received",
  under_review: "Under review",
  actioned: "Actioned",
  dismissed: "Dismissed"
};

const CONTENT_REPORT_TRANSITIONS: Record<ContentReportStatus, readonly ContentReportStatus[]> = {
  received: ["under_review", "actioned", "dismissed"],
  under_review: ["actioned", "dismissed"],
  actioned: ["under_review"],
  dismissed: ["under_review"]
};

/** Terminal states stamp resolved_at (content) / are closed (user). */
export const TERMINAL_REPORT_STATUSES = ["resolved", "dismissed", "actioned"] as const;
export function isTerminalReportStatus(status: string): boolean {
  return (TERMINAL_REPORT_STATUSES as readonly string[]).includes(status);
}

export function reportStatusLabel(kind: ReportKind, status: string): string {
  return kind === "user"
    ? USER_REPORT_STATUS_LABELS[status as UserReportStatus] ?? status
    : CONTENT_REPORT_STATUS_LABELS[status as ContentReportStatus] ?? status;
}

export function allowedReportTransitions(kind: ReportKind, from: string): readonly string[] {
  return kind === "user"
    ? USER_REPORT_TRANSITIONS[from as UserReportStatus] ?? []
    : CONTENT_REPORT_TRANSITIONS[from as ContentReportStatus] ?? [];
}

export function canTransitionReport(kind: ReportKind, from: string, to: string): boolean {
  if (from === to) return false;
  return allowedReportTransitions(kind, from).includes(to);
}

export function reportStatusTone(kind: ReportKind, status: string): "default" | "success" | "warning" | "danger" {
  if (status === "open" || status === "received") return "danger";
  if (status === "reviewing" || status === "under_review") return "warning";
  if (status === "resolved" || status === "actioned") return "success";
  return "default"; // dismissed
}

// --- Content categories / types -------------------------------------------
export const CONTENT_REPORT_CATEGORIES = [
  "harassment",
  "threat_or_violence",
  "sexual_content",
  "hate_or_discrimination",
  "spam",
  "scam",
  "impersonation",
  "private_information",
  "unwanted_contact",
  "dangerous_location_sharing",
  "other"
] as const;
export type ContentReportCategory = (typeof CONTENT_REPORT_CATEGORIES)[number];

export const CONTENT_REPORT_CATEGORY_LABELS: Record<ContentReportCategory, string> = {
  harassment: "Harassment",
  threat_or_violence: "Threat or violence",
  sexual_content: "Sexual content",
  hate_or_discrimination: "Hate or discrimination",
  spam: "Spam",
  scam: "Scam",
  impersonation: "Impersonation",
  private_information: "Private information",
  unwanted_contact: "Unwanted contact",
  dangerous_location_sharing: "Dangerous location sharing",
  other: "Other"
};

export function categoryLabel(category: string): string {
  return CONTENT_REPORT_CATEGORY_LABELS[category as ContentReportCategory] ?? category;
}

export const CONTENT_TYPE_LABELS: Record<string, string> = {
  moment: "Moment",
  drop: "Drop",
  message: "Message",
  profile: "Profile",
  announcement: "Announcement",
  plan: "Plan"
};
export function contentTypeLabel(type: string): string {
  return CONTENT_TYPE_LABELS[type] ?? type;
}

// Which categories signal a possible location-safety emergency — surfaced with
// restrained warning styling so a reviewer prioritises them (never auto-acts).
const HIGH_SIGNAL_CATEGORIES: readonly string[] = [
  "threat_or_violence",
  "dangerous_location_sharing",
  "private_information"
];
export function isHighSignalCategory(category: string): boolean {
  return HIGH_SIGNAL_CATEGORIES.includes(category);
}

// --- Moderation action ladder (public.moderation_actions.action_type) ------
export const MODERATION_ACTION_TYPES = [
  "no_action",
  "restore_content",
  "hide_content",
  "remove_content",
  "warn_user",
  "rate_limit_user",
  "suspend_feature",
  "temporary_suspension",
  "permanent_suspension",
  "escalate"
] as const;
export type ModerationActionType = (typeof MODERATION_ACTION_TYPES)[number];

export const MODERATION_ACTION_LABELS: Record<ModerationActionType, string> = {
  no_action: "No action needed",
  restore_content: "Restore content",
  hide_content: "Hide content",
  remove_content: "Remove content",
  warn_user: "Warn user",
  rate_limit_user: "Rate-limit user",
  suspend_feature: "Suspend a feature",
  temporary_suspension: "Temporarily suspend account",
  permanent_suspension: "Permanently suspend account",
  escalate: "Escalate for senior review"
};

/**
 * Ordered least → most severe so the UI presents "use the least severe
 * effective action" first and escalation reads as a deliberate step.
 */
export const MODERATION_ACTION_LADDER: readonly ModerationActionType[] = [
  "no_action",
  "restore_content",
  "hide_content",
  "remove_content",
  "warn_user",
  "rate_limit_user",
  "suspend_feature",
  "temporary_suspension",
  "permanent_suspension",
  "escalate"
];

/**
 * Maps a moderation action to the enforcement restriction it applies, or null
 * for content-only / workflow actions. The restriction is applied through the
 * existing permission-checked, audited applyUserRestriction — never inline.
 */
export function moderationActionToRestriction(action: ModerationActionType): RestrictionType | null {
  switch (action) {
    case "warn_user":
      return "warn";
    case "rate_limit_user":
      return "rate_limited";
    case "suspend_feature":
      return "messaging_disabled";
    case "temporary_suspension":
      return "suspended_temporary";
    case "permanent_suspension":
      return "suspended_permanent";
    default:
      return null;
  }
}

/** Content-manipulation actions only make sense for a content report. */
const CONTENT_ONLY_ACTIONS: readonly ModerationActionType[] = ["restore_content", "hide_content", "remove_content"];

/** The actions offered for a given report kind. */
export function availableModerationActions(kind: ReportKind): readonly ModerationActionType[] {
  return kind === "content"
    ? MODERATION_ACTION_LADDER
    : MODERATION_ACTION_LADDER.filter((action) => !CONTENT_ONLY_ACTIONS.includes(action));
}

/** Every action except a pure "no action" must carry a written reason. */
export function moderationRequiresReason(action: ModerationActionType): boolean {
  return action !== "no_action";
}

/** Only a temporary suspension takes a duration. */
export function moderationTakesDuration(action: ModerationActionType): boolean {
  return action === "temporary_suspension";
}

/**
 * Severity for sorting/guarding. Actions that carry a restriction inherit the
 * ladder severity of that restriction (offset above content ops); content-only
 * and workflow actions sort by their position in the action ladder.
 */
export function moderationActionSeverity(action: ModerationActionType): number {
  const restriction = moderationActionToRestriction(action);
  if (restriction) return 100 + restrictionSeverity(restriction);
  return MODERATION_ACTION_LADDER.indexOf(action);
}

/** Whether an action is a hard, appeal-worthy account suspension. */
export function isAccountSuspension(action: ModerationActionType): boolean {
  return action === "temporary_suspension" || action === "permanent_suspension";
}

// Re-export for the UI so callers don't reach into governance directly.
export { RESTRICTION_LADDER };
