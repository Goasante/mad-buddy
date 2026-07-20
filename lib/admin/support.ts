/**
 * Support & issues domain logic (Admin slice).
 *
 * Pure, server-agnostic helpers shared by the server actions (which enforce
 * them) and the Admin UI (which mirrors them so no control is offered for a
 * transition the server would reject). Machine values REUSE the canonical
 * public.support_tickets check constraints — no competing status/priority model
 * is introduced. Only the human-facing labels are defined here.
 */

// --- Statuses -------------------------------------------------------------
// Canonical machine values from the support_tickets CHECK constraint.
export const SUPPORT_STATUSES = [
  "new",
  "open",
  "waiting_on_user",
  "waiting_on_internal_team",
  "resolved",
  "closed",
  "escalated"
] as const;
export type SupportStatus = (typeof SUPPORT_STATUSES)[number];

export const SUPPORT_STATUS_LABELS: Record<SupportStatus, string> = {
  new: "New",
  open: "In progress",
  waiting_on_user: "Waiting for user",
  waiting_on_internal_team: "Waiting on internal team",
  resolved: "Resolved",
  closed: "Closed",
  escalated: "Escalated"
};

/** Terminal statuses stamp resolved_at and require an explicit reopen to leave. */
export const TERMINAL_STATUSES: readonly SupportStatus[] = ["resolved", "closed"];

export function isTerminalStatus(status: SupportStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

/**
 * Allowed status transitions, enforced server-side. Arbitrary payloads are
 * rejected. A closed issue can only move via the explicit reopen path
 * (closed → open); no other transition out of closed exists.
 */
const STATUS_TRANSITIONS: Record<SupportStatus, readonly SupportStatus[]> = {
  new: ["open", "waiting_on_user", "escalated", "closed"],
  open: ["waiting_on_user", "waiting_on_internal_team", "escalated", "resolved", "closed"],
  waiting_on_user: ["open", "waiting_on_internal_team", "resolved", "closed"],
  waiting_on_internal_team: ["open", "waiting_on_user", "resolved", "closed"],
  escalated: ["open", "waiting_on_user", "resolved", "closed"],
  // Reopen only. Marking resolved must be a deliberate move back into work.
  resolved: ["open", "closed"],
  // Closed leaves only through reopen.
  closed: ["open"]
};

export function allowedTransitions(from: SupportStatus): readonly SupportStatus[] {
  return STATUS_TRANSITIONS[from] ?? [];
}

export function canTransitionStatus(from: SupportStatus, to: SupportStatus): boolean {
  if (from === to) return false;
  return allowedTransitions(from).includes(to);
}

/** The reopen path is specifically the terminal → open move. */
export function isReopen(from: SupportStatus, to: SupportStatus): boolean {
  return isTerminalStatus(from) && to === "open";
}

// Primary list filters (spec) mapped onto canonical statuses.
export const STATUS_FILTER_GROUPS = {
  all: SUPPORT_STATUSES,
  new: ["new"],
  in_progress: ["open", "waiting_on_internal_team", "escalated"],
  waiting_for_user: ["waiting_on_user"],
  resolved: ["resolved"],
  closed: ["closed"]
} as const satisfies Record<string, readonly SupportStatus[]>;
export type StatusFilterKey = keyof typeof STATUS_FILTER_GROUPS;

export function isStatusFilterKey(value: string): value is StatusFilterKey {
  return value in STATUS_FILTER_GROUPS;
}

export function statusTone(status: SupportStatus): "default" | "success" | "warning" | "danger" {
  if (status === "escalated") return "danger";
  if (status === "resolved" || status === "closed") return "success";
  if (status === "waiting_on_user" || status === "waiting_on_internal_team") return "warning";
  return "default";
}

// --- Priorities -----------------------------------------------------------
// Canonical machine values. "urgent" is the top (Critical) tier.
export const SUPPORT_PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export type SupportPriority = (typeof SUPPORT_PRIORITIES)[number];

export const SUPPORT_PRIORITY_LABELS: Record<SupportPriority, string> = {
  low: "Low",
  normal: "Normal",
  high: "High",
  urgent: "Critical"
};

/** The Critical tier requires a written reason and an explicit confirmation. */
export const CRITICAL_PRIORITY: SupportPriority = "urgent";

export function priorityRequiresReason(priority: SupportPriority): boolean {
  return priority === CRITICAL_PRIORITY;
}

export function priorityTone(priority: SupportPriority): "default" | "success" | "warning" | "danger" {
  if (priority === "urgent") return "danger";
  if (priority === "high") return "warning";
  return "default";
}

// --- Categories -----------------------------------------------------------
// Canonical machine values from the support_tickets CHECK constraint.
export const SUPPORT_CATEGORIES = [
  "getting_started",
  "muddies",
  "visibility",
  "location",
  "plans",
  "billing",
  "privacy",
  "security",
  "communities",
  "reporting",
  "account_deletion",
  "other"
] as const;
export type SupportCategory = (typeof SUPPORT_CATEGORIES)[number];

export const SUPPORT_CATEGORY_LABELS: Record<SupportCategory, string> = {
  getting_started: "Account & getting started",
  muddies: "Muddies & connections",
  visibility: "Visibility & glow",
  location: "Location & proximity",
  plans: "Plans & events",
  billing: "Subscription & billing",
  privacy: "Privacy & safety",
  security: "Security & login",
  communities: "Communities & groups",
  reporting: "Reporting & moderation",
  account_deletion: "Account deletion",
  other: "Other"
};

// --- Assignment -----------------------------------------------------------
export type StaffStandingValue = "owner" | "admin" | "support" | "standard";

/**
 * Whether a candidate can receive a support-issue assignment. Only active
 * staff (owner/admin/support) are eligible — never a standard user, an inactive
 * staff record, or a deleted account.
 */
export function isAssignableStaff(candidate: { standing: StaffStandingValue; active: boolean }): boolean {
  return candidate.active && candidate.standing !== "standard";
}

// --- Labels & helpers -----------------------------------------------------
export function statusLabel(status: string): string {
  return SUPPORT_STATUS_LABELS[status as SupportStatus] ?? status;
}
export function priorityLabel(priority: string): string {
  return SUPPORT_PRIORITY_LABELS[priority as SupportPriority] ?? priority;
}
export function categoryLabel(category: string): string {
  return SUPPORT_CATEGORY_LABELS[category as SupportCategory] ?? category;
}

/** Human-readable one-liner for a ticket event, used by the detail timeline. */
export function describeSupportEvent(event: {
  eventType: string;
  fromValue: string | null;
  toValue: string | null;
}): string {
  switch (event.eventType) {
    case "status_changed":
      return `Status changed from ${statusLabel(event.fromValue ?? "")} to ${statusLabel(event.toValue ?? "")}`;
    case "priority_changed":
      return `Priority changed from ${priorityLabel(event.fromValue ?? "")} to ${priorityLabel(event.toValue ?? "")}`;
    case "assigned":
      return "Assigned";
    case "unassigned":
      return "Unassigned";
    case "transferred":
      return "Assignment transferred";
    case "reopened":
      return "Issue reopened";
    case "response_sent":
      return "Public response sent";
    case "note_added":
      return "Internal note added";
    default:
      return event.eventType;
  }
}

// --- Response templates (insert-only; never auto-send) ---------------------
export type SupportTemplate = { id: string; label: string; body: string };

export const SUPPORT_TEMPLATES: SupportTemplate[] = [
  {
    id: "location_permission",
    label: "Location permission guidance",
    body:
      "Thanks for reaching out. Mad Buddy needs location permission to show nearby glow. Please open your device settings, find Mad Buddy, and set location access to “While Using”. Reopen the app afterwards and let us know if it helps."
  },
  {
    id: "notification_permission",
    label: "Notification permission guidance",
    body:
      "To receive alerts, please enable notifications for Mad Buddy in your device settings. Once enabled, reopen the app so we can register your device. Tell us if anything still looks off."
  },
  {
    id: "profile_image",
    label: "Profile image upload issue",
    body:
      "Sorry about the trouble uploading your profile photo. Please try a JPG or PNG under 5 MB on a stable connection. If it still fails, let us know your device and app version and we’ll dig in."
  },
  {
    id: "moment_image",
    label: "Moment image issue",
    body:
      "Thanks for flagging this. Please try re-uploading the Moment on a stable connection. If the image still won’t appear, tell us the approximate time you posted it so we can trace it."
  },
  {
    id: "subscription_verification",
    label: "Subscription verification",
    body:
      "We’re checking your subscription now. This can take a few minutes after payment. If your plan hasn’t updated shortly, reply here and we’ll verify it on our side."
  },
  {
    id: "session_reset",
    label: "Session reset guidance",
    body:
      "Let’s reset your session. Please sign out fully, close the app, reopen it, and sign back in. If you’re still stuck, tell us what you see on screen."
  },
  {
    id: "known_issue",
    label: "Known issue acknowledgement",
    body:
      "Thanks for your patience. This is a known issue our team is already working on. We’ll update you here as soon as a fix ships."
  },
  {
    id: "more_info",
    label: "Request for more information",
    body:
      "To help us investigate, could you share a bit more detail — what you were doing, what you expected, and what happened instead? Your device and app version help too."
  }
];
