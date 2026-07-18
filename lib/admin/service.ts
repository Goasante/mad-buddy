import "server-only";

import {
  actorHasPermission,
  type AdminAssignment,
  type AdminPermission,
  type AdminRole,
  type AuthStrength,
  type EmergencyControl,
  type RestrictionType,
  type SensitiveCategory
} from "@/lib/admin/governance";
import type { createSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * Admin server service (spec §65). Uses the service-role client, so every
 * function here is a place where a mistake would be serious. Two invariants:
 *
 *  - No function returns private user content. Sensitive reads must go through
 *    recordSensitiveAccess FIRST, which fails closed if the access wasn't
 *    justified, there is no "read and maybe log later" path.
 *  - Audit writes are best-effort-proof: if the audit insert fails, the action
 *    is refused rather than performed unlogged (spec §56).
 */

type Admin = ReturnType<typeof createSupabaseAdminClient>;

export async function loadAdminAssignments(admin: Admin, userId: string): Promise<AdminAssignment[]> {
  const { data } = await admin
    .from("admin_assignments")
    .select("status, starts_at, expires_at, admin_roles(name)")
    .eq("user_id", userId);

  return (data ?? []).map((row) => {
    const roleRelation = row.admin_roles as unknown as { name: string } | { name: string }[] | null;
    const roleName = Array.isArray(roleRelation) ? roleRelation[0]?.name : roleRelation?.name;
    return {
      role: (roleName ?? "read_only_auditor") as AdminRole,
      status: row.status as AdminAssignment["status"],
      startsAtMs: Date.parse(row.starts_at),
      expiresAtMs: row.expires_at ? Date.parse(row.expires_at) : null
    };
  });
}

/** The single permission gate. Expired/revoked assignments grant nothing. */
export async function canAdminActor(
  admin: Admin,
  userId: string,
  permission: AdminPermission,
  nowMs = Date.now()
): Promise<boolean> {
  const assignments = await loadAdminAssignments(admin, userId);
  return actorHasPermission({ assignments, permission, nowMs });
}

export type AuditEvent = {
  actorId: string;
  actorRole?: string;
  action: string;
  targetType?: string;
  targetId?: string;
  caseReference?: string;
  previousState?: Record<string, unknown>;
  newState?: Record<string, unknown>;
  reason?: string;
  authStrength?: AuthStrength;
  sessionReference?: string;
};

/**
 * Appends an audit event. Returns false when the write fails so callers can
 * refuse the action, an unlogged privileged action is worse than a failed
 * one (spec §56). The table is append-only via a database trigger, so not even
 * this service role can rewrite history.
 */
export async function recordAdminAuditEvent(admin: Admin, event: AuditEvent): Promise<boolean> {
  const { error } = await admin.from("admin_audit_events").insert({
    actor_id: event.actorId,
    actor_role: event.actorRole ?? null,
    action: event.action,
    target_type: event.targetType ?? null,
    target_id: event.targetId ?? null,
    case_reference: event.caseReference ?? null,
    previous_state: (event.previousState ?? null) as never,
    new_state: (event.newState ?? null) as never,
    reason: event.reason ?? null,
    auth_strength: event.authStrength ?? null,
    session_reference: event.sessionReference ?? null
  });
  return !error;
}

/**
 * Records a sensitive data view BEFORE it happens (spec §58). Callers must
 * treat a false return as a hard stop: if we can't log the access, the access
 * doesn't happen.
 */
export async function recordSensitiveAccess(
  admin: Admin,
  input: {
    actorId: string;
    category: SensitiveCategory;
    subjectUserId: string;
    caseReference: string;
    reason: string;
    approvedBy?: string;
  }
): Promise<boolean> {
  const { error } = await admin.from("sensitive_access_log").insert({
    actor_id: input.actorId,
    category: input.category as never,
    subject_user_id: input.subjectUserId,
    case_reference: input.caseReference,
    reason: input.reason,
    approved_by: input.approvedBy ?? null
  });
  return !error;
}

// ---------------------------------------------------------------------------
// Emergency controls (spec §62), must work instantly, without a deploy.
// ---------------------------------------------------------------------------

/**
 * Whether a feature is currently killed. Guarded features should call this on
 * the request path. Fails CLOSED for the location-related controls: if we
 * can't read the switch during an incident, we assume the kill is on rather
 * than keep serving proximity (spec §47: safety outranks uptime).
 */
export async function isFeatureKilled(admin: Admin, control: EmergencyControl): Promise<boolean> {
  const failClosed = control === "proximity" || control === "location_collection" || control === "event_glow";
  try {
    const { data, error } = await admin
      .from("emergency_controls")
      .select("is_disabled")
      .eq("control_key", control)
      .maybeSingle();
    if (error) return failClosed;
    return data?.is_disabled ?? false;
  } catch {
    return failClosed;
  }
}

export async function activateEmergencyControl(
  admin: Admin,
  input: { control: EmergencyControl; actorId: string; reason: string; incidentId?: string }
): Promise<boolean> {
  const logged = await recordAdminAuditEvent(admin, {
    actorId: input.actorId,
    action: "activate_emergency_control",
    targetType: "emergency_control",
    reason: input.reason,
    newState: { control: input.control, disabled: true },
    authStrength: "step_up"
  });
  // Refuse to flip a kill switch we couldn't log.
  if (!logged) return false;

  const { error } = await admin
    .from("emergency_controls")
    .update({
      is_disabled: true,
      reason: input.reason,
      incident_id: input.incidentId ?? null,
      disabled_by: input.actorId,
      disabled_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    })
    .eq("control_key", input.control);
  return !error;
}

// ---------------------------------------------------------------------------
// Restrictions (spec §12, §19)
// ---------------------------------------------------------------------------

/** Active restrictions for a user. Enforcement reads this, not a plan or role. */
export async function activeRestrictions(admin: Admin, userId: string): Promise<RestrictionType[]> {
  const nowIso = new Date().toISOString();
  const { data } = await admin
    .from("user_restrictions")
    .select("restriction_type, ends_at")
    .eq("user_id", userId)
    .is("lifted_at", null);

  return (data ?? [])
    .filter((row) => !row.ends_at || row.ends_at > nowIso)
    .map((row) => row.restriction_type as RestrictionType);
}

export async function isSuspended(admin: Admin, userId: string): Promise<boolean> {
  const restrictions = await activeRestrictions(admin, userId);
  return restrictions.includes("suspended_temporary") || restrictions.includes("suspended_permanent");
}

/**
 * Applies a restriction. Requires the permission AND produces an audit record;
 * refuses if either fails, so no user is restricted without a trail.
 */
export async function applyUserRestriction(
  admin: Admin,
  input: {
    actorId: string;
    userId: string;
    restriction: RestrictionType;
    reasonCode: string;
    caseId?: string;
    endsAtMs?: number | null;
  }
): Promise<{ ok: boolean; message: string }> {
  const permission: AdminPermission =
    input.restriction === "suspended_temporary" || input.restriction === "suspended_permanent"
      ? "admin.users.suspend"
      : "admin.users.restrict";

  if (!(await canAdminActor(admin, input.actorId, permission))) {
    return { ok: false, message: "You don't have permission to do that." };
  }

  const logged = await recordAdminAuditEvent(admin, {
    actorId: input.actorId,
    action: `restrict:${input.restriction}`,
    targetType: "user",
    targetId: input.userId,
    caseReference: input.caseId,
    reason: input.reasonCode,
    newState: { restriction: input.restriction },
    authStrength: "step_up"
  });
  if (!logged) return { ok: false, message: "Couldn't record the audit entry, so no action was taken." };

  if (input.restriction === "warn") return { ok: true, message: "Warning recorded." };

  const { error } = await admin.from("user_restrictions").insert({
    user_id: input.userId,
    restriction_type: input.restriction,
    case_id: input.caseId ?? null,
    reason_code: input.reasonCode,
    ends_at: input.endsAtMs ? new Date(input.endsAtMs).toISOString() : null
  });
  if (error) return { ok: false, message: "Couldn't apply that restriction." };
  return { ok: true, message: "Restriction applied." };
}
