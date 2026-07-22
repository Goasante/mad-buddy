/**
 * Admin governance core (feature architecture batch 13). Pure, deterministic
 * rules for who may do what, when step-up auth is required, and when sensitive
 * access is permitted.
 *
 * The governing rule (spec §1): staff have NO ambient access to exact location,
 * private messages, Safe Arrival details, close friends, private circles,
 * private media, contact-matching data, payment credentials, or tokens.
 *
 * That is enforced structurally here in three ways:
 *  1. Permission keys are granular. There is deliberately no `admin_all` or
 *     `superuser` key to hold (spec §4).
 *  2. No role's permission set includes reading private content. Sensitive
 *     access is not a permission, it is a case-bound, expiring GRANT.
 *  3. Everything sensitive requires a case reference + a reason, and returns
 *     an audit record. There is no code path that reads private data without
 *     producing one.
 */

// ---------------------------------------------------------------------------
// Permissions (spec §4)
// ---------------------------------------------------------------------------

export const ADMIN_PERMISSIONS = [
  "admin.users.view_summary",
  "admin.users.restrict",
  "admin.users.suspend",
  "admin.users.restore",
  "admin.users.recovery_link",
  "admin.sessions.revoke",
  "admin.reports.review",
  "admin.appeals.review",
  "admin.support.manage",
  "admin.billing.view",
  "admin.billing.refund",
  "admin.billing.manage_plan",
  "admin.verification.review",
  "admin.organisations.restrict",
  "admin.security.events.view",
  "admin.security.incidents.manage",
  "admin.privacy.requests.manage",
  "admin.audit.view",
  "admin.feature_flags.manage",
  "admin.emergency_controls.manage",
  "admin.roles.manage"
] as const;

export type AdminPermission = (typeof ADMIN_PERMISSIONS)[number];

export type AdminRole =
  | "super_administrator"
  | "trust_safety_administrator"
  | "customer_support_agent"
  | "billing_support_agent"
  | "verification_reviewer"
  | "security_engineer"
  | "privacy_administrator"
  | "read_only_auditor";

// ---------------------------------------------------------------------------
// Team-access role grants (spec §2). The consumer-facing staff hierarchy is a
// coarse three-tier model (owner/admin/support) on top of the granular
// governance roles above. This is the ONE place that decides whether an actor
// may change another user's staff role — the server action calls it, never the
// client. It is pure so the full grant matrix is unit-tested.
// ---------------------------------------------------------------------------

export type StaffRole = "owner" | "admin" | "support";
/** A target's current staff standing, including "standard" (not staff). */
export type StaffStanding = StaffRole | "standard";

export type StaffGrantResult = {
  allowed: boolean;
  reason:
    | "owner_not_assignable"
    | "cannot_modify_owner"
    | "not_permitted"
    | "admin_cannot_grant_admin"
    | "admin_cannot_manage_admin"
    | "self"
    | "no_change"
    | "allowed";
};

/**
 * Whether `actorRole` may set `targetCurrentRole` → `requestedRole`.
 *
 * The rules, straight from spec §2:
 *  - Owner is NEVER assignable through this flow (owner is bootstrap-only), so a
 *    spoofed `requestedRole: "owner"` from the client is rejected here, on the
 *    server — not merely hidden in the UI.
 *  - Owners cannot be modified through the Team UI (not removable/downgradable);
 *    the "last active owner" data check is a separate guard in the action.
 *  - Only Owner and Admin manage staff. Support and standard users cannot.
 *  - Admin may only manage Support (grant Support to a standard user, or remove
 *    a Support user). Admin cannot grant Admin, nor touch an existing Admin.
 *  - Owner may grant Admin or Support, or remove staff access (→ standard).
 *  - Nobody edits their own privileged role.
 */
export function canAssignStaffRole(input: {
  actorRole: StaffStanding;
  isSelf: boolean;
  targetCurrentRole: StaffStanding;
  /** The raw requested standing from the client — validated here, not trusted. */
  requestedRole: StaffStanding;
}): StaffGrantResult {
  // Owner can never be granted through Team access.
  if (input.requestedRole === "owner") return { allowed: false, reason: "owner_not_assignable" };
  // Owners are untouchable via the UI.
  if (input.targetCurrentRole === "owner") return { allowed: false, reason: "cannot_modify_owner" };
  // Only owner/admin manage staff.
  if (input.actorRole !== "owner" && input.actorRole !== "admin") {
    return { allowed: false, reason: "not_permitted" };
  }
  // No self privilege edits.
  if (input.isSelf) return { allowed: false, reason: "self" };
  // No-op.
  if (input.targetCurrentRole === input.requestedRole) return { allowed: false, reason: "no_change" };

  if (input.actorRole === "admin") {
    // Admin may only ever manage Support.
    if (input.requestedRole === "admin") return { allowed: false, reason: "admin_cannot_grant_admin" };
    if (input.targetCurrentRole === "admin") return { allowed: false, reason: "admin_cannot_manage_admin" };
    return { allowed: true, reason: "allowed" };
  }

  // Owner may grant admin/support or remove access.
  return { allowed: true, reason: "allowed" };
}

/**
 * The role → permission matrix (spec §3). Each role gets the narrowest set
 * that lets it do its job. Note what is NOT here: no role grants reading
 * messages, location, or private media, those aren't permissions at all.
 */
export const ROLE_PERMISSIONS: Record<AdminRole, readonly AdminPermission[]> = {
  super_administrator: ADMIN_PERMISSIONS,
  trust_safety_administrator: [
    "admin.users.view_summary",
    "admin.users.restrict",
    "admin.users.suspend",
    "admin.users.restore",
    "admin.users.recovery_link",
    "admin.reports.review",
    "admin.appeals.review",
    "admin.organisations.restrict",
    "admin.audit.view",
    "admin.roles.manage",
    "admin.support.manage",
    "admin.sessions.revoke"
  ],
  customer_support_agent: [
    "admin.users.view_summary",
    "admin.users.suspend",
    "admin.users.recovery_link",
    "admin.sessions.revoke",
    "admin.support.manage"
  ],
  billing_support_agent: ["admin.users.view_summary", "admin.users.suspend", "admin.billing.view", "admin.billing.refund"],
  verification_reviewer: ["admin.users.view_summary", "admin.users.suspend", "admin.verification.review"],
  security_engineer: [
    "admin.users.view_summary",
    "admin.sessions.revoke",
    "admin.security.events.view",
    "admin.security.incidents.manage",
    "admin.audit.view",
    "admin.users.suspend"
  ],
  privacy_administrator: ["admin.users.view_summary", "admin.users.suspend", "admin.privacy.requests.manage", "admin.audit.view"],
  // Audit-only staff may still apply the universal account safety hold.
  read_only_auditor: ["admin.audit.view", "admin.users.view_summary", "admin.users.suspend"]
};

export type AdminAssignment = {
  role: AdminRole;
  status: "active" | "suspended" | "revoked";
  startsAtMs: number;
  /** Temporary access expires on its own (spec §6). */
  expiresAtMs: number | null;
};

export function isAssignmentActive(assignment: AdminAssignment, nowMs: number): boolean {
  if (assignment.status !== "active") return false;
  if (assignment.startsAtMs > nowMs) return false;
  if (assignment.expiresAtMs !== null && assignment.expiresAtMs <= nowMs) return false;
  return true;
}

/**
 * Whether an actor holds a permission right now. Expired and revoked
 * assignments grant nothing, this is the only function that should decide.
 */
export function actorHasPermission(input: {
  assignments: AdminAssignment[];
  permission: AdminPermission;
  nowMs: number;
}): boolean {
  return input.assignments.some(
    (assignment) =>
      isAssignmentActive(assignment, input.nowMs) &&
      ROLE_PERMISSIONS[assignment.role]?.includes(input.permission)
  );
}

export function permissionsForRole(role: AdminRole): readonly AdminPermission[] {
  return ROLE_PERMISSIONS[role] ?? [];
}

// ---------------------------------------------------------------------------
// Step-up authentication (spec §5)
// ---------------------------------------------------------------------------

export type AuthStrength = "password" | "mfa" | "step_up" | "break_glass";

/**
 * Actions that require fresh re-authentication, not just an admin session.
 * These are the ones whose blast radius justifies the friction (spec §5).
 */
export const STEP_UP_REQUIRED_ACTIONS = [
  "view_sensitive_evidence",
  "suspend_organisation",
  "revoke_all_sessions",
  "export_user_data",
  "process_refund",
  "activate_emergency_control",
  "assign_admin_role",
  "apply_legal_hold"
] as const;

export type StepUpAction = (typeof STEP_UP_REQUIRED_ACTIONS)[number];

export function requiresStepUp(action: string): action is StepUpAction {
  return (STEP_UP_REQUIRED_ACTIONS as readonly string[]).includes(action);
}

const STRENGTH_RANK: Record<AuthStrength, number> = {
  password: 0,
  mfa: 1,
  step_up: 2,
  break_glass: 3
};

export type AuthCheck = {
  allowed: boolean;
  reason: "mfa_required" | "step_up_required" | "stale_step_up" | "allowed";
};

/** Step-up is only valid briefly, a morning re-auth can't justify an evening action. */
export const STEP_UP_VALIDITY_MS = 15 * 60 * 1000;

/**
 * Whether an actor's current authentication is strong AND fresh enough.
 * MFA is the floor for ANY admin action (spec §5); step-up actions need a
 * recent re-auth on top.
 */
export function checkAdminAuth(input: {
  action: string;
  authStrength: AuthStrength;
  stepUpAtMs: number | null;
  nowMs: number;
}): AuthCheck {
  if (STRENGTH_RANK[input.authStrength] < STRENGTH_RANK.mfa) {
    return { allowed: false, reason: "mfa_required" };
  }
  if (!requiresStepUp(input.action)) return { allowed: true, reason: "allowed" };

  if (STRENGTH_RANK[input.authStrength] < STRENGTH_RANK.step_up) {
    return { allowed: false, reason: "step_up_required" };
  }
  if (input.stepUpAtMs === null || input.nowMs - input.stepUpAtMs > STEP_UP_VALIDITY_MS) {
    return { allowed: false, reason: "stale_step_up" };
  }
  return { allowed: true, reason: "allowed" };
}

// ---------------------------------------------------------------------------
// Progressive + case-bound access (spec §10, §11, §18)
// ---------------------------------------------------------------------------

export type AccessLevel = "level_1" | "level_2" | "level_3" | "level_4";

/**
 * Fields a Level-1 summary may contain (spec §9). Everything sensitive is
 * absent by construction, this list IS the contract.
 */
export const SAFE_ACCOUNT_SUMMARY_FIELDS = [
  "user_id",
  "display_name",
  "username",
  "email_verified",
  "phone_verified",
  "account_age_label",
  "account_status",
  "subscription_tier",
  "report_count",
  "active_restrictions",
  "session_count",
  "last_security_event",
  "support_ticket_count"
] as const;

/**
 * Data categories that are NEVER available at level 1/2, whatever the role.
 * Reaching any of these requires a case, a reason, and an audit record.
 */
export const SENSITIVE_CATEGORIES = [
  "exact_location",
  "location_history",
  "private_messages",
  "safe_arrival_details",
  "close_friends",
  "circle_membership",
  "private_media",
  "contact_matching_data",
  "payment_credentials",
  "authentication_tokens"
] as const;

export type SensitiveCategory = (typeof SENSITIVE_CATEGORIES)[number];

/** Categories that no support/safety workflow may reach at all (spec §1). */
const NEVER_ACCESSIBLE: ReadonlySet<string> = new Set<SensitiveCategory>([
  "payment_credentials",
  "authentication_tokens",
  "location_history"
]);

export type CaseBoundAccessInput = {
  permission: AdminPermission | null;
  /** An open case justifying the access (spec §11). */
  caseId: string | null;
  reason: string;
  category: SensitiveCategory;
  requiredLevel: AccessLevel;
  actorMaxLevel: AccessLevel;
  authStrength: AuthStrength;
  stepUpAtMs: number | null;
  nowMs: number;
};

export type CaseBoundAccessResult = {
  allowed: boolean;
  reason:
    | "never_accessible"
    | "no_case"
    | "no_reason"
    | "insufficient_level"
    | "no_permission"
    | "step_up_required"
    | "allowed";
  /** Always true when allowed: sensitive access is never silent. */
  mustAudit: boolean;
};

const LEVEL_RANK: Record<AccessLevel, number> = {
  level_1: 1,
  level_2: 2,
  level_3: 3,
  level_4: 4
};

/**
 * The gate for every sensitive read. Deliberately strict: a missing case or a
 * missing reason denies, so "just having a look" is not a reachable state.
 */
export function resolveCaseBoundAccess(input: CaseBoundAccessInput): CaseBoundAccessResult {
  // Some categories have no legitimate staff workflow at all.
  if (NEVER_ACCESSIBLE.has(input.category)) {
    return { allowed: false, reason: "never_accessible", mustAudit: true };
  }
  if (!input.permission) return { allowed: false, reason: "no_permission", mustAudit: true };
  if (!input.caseId) return { allowed: false, reason: "no_case", mustAudit: true };
  if (!input.reason || input.reason.trim().length < 1) {
    return { allowed: false, reason: "no_reason", mustAudit: true };
  }
  if (LEVEL_RANK[input.actorMaxLevel] < LEVEL_RANK[input.requiredLevel]) {
    return { allowed: false, reason: "insufficient_level", mustAudit: true };
  }

  const auth = checkAdminAuth({
    action: "view_sensitive_evidence",
    authStrength: input.authStrength,
    stepUpAtMs: input.stepUpAtMs,
    nowMs: input.nowMs
  });
  if (!auth.allowed) return { allowed: false, reason: "step_up_required", mustAudit: true };

  return { allowed: true, reason: "allowed", mustAudit: true };
}

// ---------------------------------------------------------------------------
// Restriction ladder (spec §12)
// ---------------------------------------------------------------------------

export type RestrictionType =
  | "warn"
  | "rate_limited"
  | "messaging_disabled"
  | "media_disabled"
  | "invites_disabled"
  | "community_creation_disabled"
  | "suspended_temporary"
  | "suspended_permanent";

/** Ordered least → most severe. "Use the least severe effective action." */
export const RESTRICTION_LADDER: readonly RestrictionType[] = [
  "warn",
  "rate_limited",
  "messaging_disabled",
  "media_disabled",
  "invites_disabled",
  "community_creation_disabled",
  "suspended_temporary",
  "suspended_permanent"
];

export function restrictionSeverity(restriction: RestrictionType): number {
  return RESTRICTION_LADDER.indexOf(restriction);
}

/**
 * The lightest restriction that addresses a case at this level. Encodes §12's
 * "least severe effective action" so escalation is a decision, not a default.
 */
export function suggestedRestriction(priority: "level_1" | "level_2" | "level_3" | "level_4"): RestrictionType {
  switch (priority) {
    case "level_1":
      return "warn";
    case "level_2":
      return "rate_limited";
    case "level_3":
      return "suspended_temporary";
    case "level_4":
      return "suspended_permanent";
  }
}

/** Interim protections must be reversible and time-bounded (spec §17). */
export function isReversible(restriction: RestrictionType): boolean {
  return restriction !== "suspended_permanent";
}

/**
 * A central suspension must apply everywhere at once, partial enforcement is
 * a bypass (spec §19). This is the list the enforcement service checks.
 */
export const SUSPENSION_BLOCKS = [
  "messaging",
  "waves",
  "pings",
  "plans",
  "moments",
  "drops",
  "communities",
  "event_glow",
  "invite_links",
  "workspace_administration"
] as const;

/** Copy for the affected user: says what and why, never how detection works. */
export function restrictionNotice(restriction: RestrictionType, endsAt: string | null): string {
  const duration = endsAt ? ` until ${endsAt}` : "";
  switch (restriction) {
    case "warn":
      return "We've sent you a warning about activity that breaks our rules.";
    case "suspended_permanent":
      return "Your account has been suspended. You can appeal this decision.";
    case "suspended_temporary":
      return `Your account is suspended${duration}. You can appeal this decision.`;
    default:
      return `Some features are limited${duration}. You can still use the rest of Mad Buddy, and you can appeal.`;
  }
}

// ---------------------------------------------------------------------------
// Incidents + kill switches (spec §44, §46, §62)
// ---------------------------------------------------------------------------

export type IncidentSeverity = "sev_1" | "sev_2" | "sev_3" | "sev_4";

export type EmergencyControl =
  | "proximity"
  | "location_collection"
  | "messaging"
  | "media_uploads"
  | "invite_links"
  | "payments"
  | "event_glow"
  | "contact_matching";

/**
 * A suspected location exposure is the one incident type with a prescribed
 * response (spec §47): kill proximity and collection, and force visibility
 * hidden. User safety outranks uptime, so this is not a judgement call.
 */
export function controlsForIncident(incidentType: string): EmergencyControl[] {
  if (incidentType === "location_exposure") {
    return ["proximity", "location_collection", "event_glow"];
  }
  if (incidentType === "account_takeover") return ["invite_links"];
  if (incidentType === "billing_compromise") return ["payments"];
  return [];
}

export function severityRequiresImmediateContainment(severity: IncidentSeverity): boolean {
  return severity === "sev_1" || severity === "sev_2";
}

/** A location-exposure incident forces visibility hidden platform-wide (§47). */
export function forcesGhostMode(incidentType: string): boolean {
  return incidentType === "location_exposure";
}

// ---------------------------------------------------------------------------
// Support diagnostics (spec §26, §27)
// ---------------------------------------------------------------------------

export const SAFE_DIAGNOSTIC_FIELDS = [
  "app_version",
  "browser",
  "operating_system",
  "route",
  "error_reference",
  "last_failed_action_category",
  "permission_state",
  "subscription_state",
  "network_category"
] as const;

/**
 * Strips a diagnostics blob to the safe allowlist. A support ticket must never
 * become a channel for location, message content, or credentials to reach
 * staff (spec §27), so this filters rather than trusts the client.
 */
export function sanitizeDiagnostics(raw: Record<string, unknown>): Record<string, string> {
  const output: Record<string, string> = {};
  for (const field of SAFE_DIAGNOSTIC_FIELDS) {
    const value = raw[field];
    if (typeof value === "string" && value.length <= 200) output[field] = value;
  }
  return output;
}

/** Support must never ask for these (spec §26, §36). */
export const NEVER_REQUEST_FROM_USER = [
  "password",
  "one_time_code",
  "mfa_code",
  "payment_card_number",
  "card_security_code",
  "authentication_token",
  "recovery_code"
] as const;

// ---------------------------------------------------------------------------
// Appeals (spec §38, §40)
// ---------------------------------------------------------------------------

export const APPEALABLE_ACTIONS: readonly RestrictionType[] = [
  "suspended_temporary",
  "suspended_permanent",
  "messaging_disabled",
  "media_disabled",
  "invites_disabled",
  "community_creation_disabled"
];

export function isAppealable(restriction: RestrictionType): boolean {
  return APPEALABLE_ACTIONS.includes(restriction);
}

export const APPEAL_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

export type AppealEligibility = {
  allowed: boolean;
  reason: "not_appealable" | "already_appealed" | "window_closed" | "allowed";
};

/**
 * One appeal per action (spec §40). A reviewer may reopen with new evidence,
 * but a user cannot re-submit the same appeal repeatedly.
 */
export function resolveAppealEligibility(input: {
  restriction: RestrictionType;
  hasExistingAppeal: boolean;
  actionAtMs: number;
  nowMs: number;
}): AppealEligibility {
  if (!isAppealable(input.restriction)) return { allowed: false, reason: "not_appealable" };
  if (input.hasExistingAppeal) return { allowed: false, reason: "already_appealed" };
  if (input.nowMs - input.actionAtMs > APPEAL_WINDOW_MS) return { allowed: false, reason: "window_closed" };
  return { allowed: true, reason: "allowed" };
}

/** A different reviewer decides an appeal wherever possible (spec §39). */
export function canReviewAppeal(input: { reviewerId: string; originalDeciderId: string | null }): boolean {
  return input.reviewerId !== input.originalDeciderId;
}
