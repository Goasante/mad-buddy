import { describe, expect, it } from "vitest";
import {
  ADMIN_PERMISSIONS,
  NEVER_REQUEST_FROM_USER,
  RESTRICTION_LADDER,
  ROLE_PERMISSIONS,
  SAFE_ACCOUNT_SUMMARY_FIELDS,
  SENSITIVE_CATEGORIES,
  SUSPENSION_BLOCKS,
  actorHasPermission,
  canAssignStaffRole,
  canReviewAppeal,
  checkAdminAuth,
  controlsForIncident,
  forcesGhostMode,
  isAppealable,
  isAssignmentActive,
  isReversible,
  permissionsForRole,
  resolveAppealEligibility,
  resolveCaseBoundAccess,
  restrictionNotice,
  restrictionSeverity,
  sanitizeDiagnostics,
  suggestedRestriction,
  type AdminAssignment,
  type CaseBoundAccessInput
} from "@/lib/admin/governance";

const NOW = Date.parse("2026-07-17T12:00:00.000Z");
const MIN = 60 * 1000;
const DAY = 24 * 60 * 60 * 1000;

describe("team-access role grants (spec §2, §18)", () => {
  const base = {
    actorRole: "owner" as const,
    isSelf: false,
    targetCurrentRole: "standard" as const,
    requestedRole: "support" as const
  };

  it("Owner can add an existing user as Admin or Support", () => {
    expect(canAssignStaffRole({ ...base, requestedRole: "admin" })).toEqual({ allowed: true, reason: "allowed" });
    expect(canAssignStaffRole({ ...base, requestedRole: "support" })).toEqual({ allowed: true, reason: "allowed" });
  });

  it("Owner can downgrade Admin→Support and remove staff (→ standard)", () => {
    expect(canAssignStaffRole({ ...base, targetCurrentRole: "admin", requestedRole: "support" }).allowed).toBe(true);
    expect(canAssignStaffRole({ ...base, targetCurrentRole: "support", requestedRole: "standard" }).allowed).toBe(true);
  });

  it("Admin can add Support but CANNOT grant Admin (default policy)", () => {
    expect(canAssignStaffRole({ ...base, actorRole: "admin", requestedRole: "support" }).allowed).toBe(true);
    expect(canAssignStaffRole({ ...base, actorRole: "admin", requestedRole: "admin" })).toEqual({
      allowed: false,
      reason: "admin_cannot_grant_admin"
    });
  });

  it("Admin cannot manage an existing Admin", () => {
    expect(
      canAssignStaffRole({ ...base, actorRole: "admin", targetCurrentRole: "admin", requestedRole: "support" }).reason
    ).toBe("admin_cannot_manage_admin");
  });

  it("nobody can grant Owner through the UI — even a spoofed client payload", () => {
    expect(canAssignStaffRole({ ...base, requestedRole: "owner" as never })).toEqual({
      allowed: false,
      reason: "owner_not_assignable"
    });
  });

  it("Owners cannot be modified through the Team UI", () => {
    expect(canAssignStaffRole({ ...base, targetCurrentRole: "owner", requestedRole: "support" }).reason).toBe(
      "cannot_modify_owner"
    );
  });

  it("Support and standard users cannot assign any role", () => {
    expect(canAssignStaffRole({ ...base, actorRole: "support" }).reason).toBe("not_permitted");
    expect(canAssignStaffRole({ ...base, actorRole: "standard" }).reason).toBe("not_permitted");
  });

  it("nobody edits their own privileged role", () => {
    expect(canAssignStaffRole({ ...base, isSelf: true, requestedRole: "admin" }).reason).toBe("self");
  });

  it("a no-op change is rejected", () => {
    expect(canAssignStaffRole({ ...base, targetCurrentRole: "support", requestedRole: "support" }).reason).toBe(
      "no_change"
    );
  });
});

describe("no ambient staff access to private data (spec §1, §4)", () => {
  it("has no wildcard permission to hold", () => {
    for (const forbidden of ["admin_all", "superuser", "admin.*", "*", "all"]) {
      expect(ADMIN_PERMISSIONS as readonly string[]).not.toContain(forbidden);
    }
  });

  it("grants no role a permission to read location, messages, or private media", () => {
    for (const [role, permissions] of Object.entries(ROLE_PERMISSIONS)) {
      for (const permission of permissions) {
        expect(permission, `${role} → ${permission}`).not.toMatch(
          /location|message|media|contact|close_friend|circle|token|password|payment_credential/i
        );
      }
    }
  });

  it("keeps the safe account summary free of anything sensitive (spec §9)", () => {
    for (const field of SAFE_ACCOUNT_SUMMARY_FIELDS) {
      expect(field).not.toMatch(/location|proximity|message|contact|close_friend|circle|media|billing_raw/i);
    }
  });

  it("keeps support focused on account help and the universal safety hold", () => {
    expect(permissionsForRole("customer_support_agent")).toEqual([
      "admin.users.view_summary",
      "admin.users.suspend",
      "admin.users.recovery_link",
      "admin.sessions.revoke",
      "admin.support.manage"
    ]);
  });

  it("limits user recovery links to owner, admin, and customer support roles", () => {
    expect(permissionsForRole("super_administrator")).toContain("admin.users.recovery_link");
    expect(permissionsForRole("trust_safety_administrator")).toContain("admin.users.recovery_link");
    expect(permissionsForRole("customer_support_agent")).toContain("admin.users.recovery_link");
    for (const role of [
      "billing_support_agent",
      "verification_reviewer",
      "security_engineer",
      "privacy_administrator",
      "read_only_auditor"
    ] as const) {
      expect(permissionsForRole(role)).not.toContain("admin.users.recovery_link");
    }
  });

  it("gives every admin role the universal account safety hold", () => {
    for (const permissions of Object.values(ROLE_PERMISSIONS)) {
      expect(permissions).toContain("admin.users.suspend");
    }
  });
});

describe("assignments expire (spec §6, §7)", () => {
  function assignment(overrides: Partial<AdminAssignment> = {}): AdminAssignment {
    return {
      role: "trust_safety_administrator",
      status: "active",
      startsAtMs: NOW - DAY,
      expiresAtMs: null,
      ...overrides
    };
  }

  it("honours an active, in-window assignment", () => {
    expect(isAssignmentActive(assignment(), NOW)).toBe(true);
    expect(
      actorHasPermission({ assignments: [assignment()], permission: "admin.users.suspend", nowMs: NOW })
    ).toBe(true);
  });

  it("grants nothing once expired, revoked, or not yet started", () => {
    expect(isAssignmentActive(assignment({ expiresAtMs: NOW - 1 }), NOW)).toBe(false);
    expect(isAssignmentActive(assignment({ status: "revoked" }), NOW)).toBe(false);
    expect(isAssignmentActive(assignment({ startsAtMs: NOW + DAY }), NOW)).toBe(false);

    expect(
      actorHasPermission({
        assignments: [assignment({ expiresAtMs: NOW - 1 })],
        permission: "admin.users.suspend",
        nowMs: NOW
      })
    ).toBe(false);
  });

  it("doesn't grant a permission the role never had", () => {
    expect(
      actorHasPermission({
        assignments: [assignment({ role: "customer_support_agent" })],
        permission: "admin.privacy.requests.manage",
        nowMs: NOW
      })
    ).toBe(false);
  });
});

describe("step-up authentication (spec §5)", () => {
  it("requires MFA as the floor for any admin action", () => {
    expect(checkAdminAuth({ action: "view_summary", authStrength: "password", stepUpAtMs: null, nowMs: NOW })).toEqual(
      { allowed: false, reason: "mfa_required" }
    );
    expect(checkAdminAuth({ action: "view_summary", authStrength: "mfa", stepUpAtMs: null, nowMs: NOW }).allowed).toBe(
      true
    );
  });

  it("demands a fresh step-up for high-blast-radius actions", () => {
    for (const action of [
      "view_sensitive_evidence",
      "revoke_all_sessions",
      "export_user_data",
      "activate_emergency_control",
      "assign_admin_role"
    ]) {
      expect(checkAdminAuth({ action, authStrength: "mfa", stepUpAtMs: null, nowMs: NOW }).reason, action).toBe(
        "step_up_required"
      );
    }
  });

  it("expires a stale step-up, a morning re-auth can't justify an evening action", () => {
    expect(
      checkAdminAuth({
        action: "export_user_data",
        authStrength: "step_up",
        stepUpAtMs: NOW - 60 * MIN,
        nowMs: NOW
      })
    ).toEqual({ allowed: false, reason: "stale_step_up" });

    expect(
      checkAdminAuth({ action: "export_user_data", authStrength: "step_up", stepUpAtMs: NOW - 5 * MIN, nowMs: NOW })
        .allowed
    ).toBe(true);
  });
});

describe("case-bound sensitive access (spec §10, §11, §18)", () => {
  function access(overrides: Partial<CaseBoundAccessInput> = {}): CaseBoundAccessInput {
    return {
      permission: "admin.reports.review",
      caseId: "case-1",
      reason: "Reviewing reported harassment",
      category: "private_messages",
      requiredLevel: "level_3",
      actorMaxLevel: "level_3",
      authStrength: "step_up",
      stepUpAtMs: NOW - MIN,
      nowMs: NOW,
      ...overrides
    };
  }

  it("allows a justified, case-bound, stepped-up read, and always audits", () => {
    expect(resolveCaseBoundAccess(access())).toEqual({ allowed: true, reason: "allowed", mustAudit: true });
  });

  it("denies 'just having a look', no case, no reason, no access", () => {
    expect(resolveCaseBoundAccess(access({ caseId: null })).reason).toBe("no_case");
    expect(resolveCaseBoundAccess(access({ reason: "  " })).reason).toBe("no_reason");
  });

  it("denies without the permission or the access level", () => {
    expect(resolveCaseBoundAccess(access({ permission: null })).reason).toBe("no_permission");
    expect(resolveCaseBoundAccess(access({ actorMaxLevel: "level_1" })).reason).toBe("insufficient_level");
  });

  it("denies without a fresh step-up", () => {
    expect(resolveCaseBoundAccess(access({ authStrength: "mfa" })).reason).toBe("step_up_required");
    expect(resolveCaseBoundAccess(access({ stepUpAtMs: NOW - 60 * MIN })).reason).toBe("step_up_required");
  });

  it("never permits credentials, tokens, or raw location history at all", () => {
    for (const category of ["payment_credentials", "authentication_tokens", "location_history"] as const) {
      const result = resolveCaseBoundAccess(access({ category, actorMaxLevel: "level_4" }));
      expect(result.allowed, category).toBe(false);
      expect(result.reason, category).toBe("never_accessible");
    }
  });

  it("audits every attempt, allowed or denied", () => {
    expect(resolveCaseBoundAccess(access()).mustAudit).toBe(true);
    expect(resolveCaseBoundAccess(access({ caseId: null })).mustAudit).toBe(true);
  });

  it("names every sensitive category the product must protect", () => {
    for (const category of [
      "exact_location",
      "private_messages",
      "safe_arrival_details",
      "close_friends",
      "private_media",
      "contact_matching_data"
    ]) {
      expect(SENSITIVE_CATEGORIES as readonly string[]).toContain(category);
    }
  });
});

describe("restriction ladder (spec §12, §17, §19)", () => {
  it("is ordered least → most severe", () => {
    expect(restrictionSeverity("warn")).toBeLessThan(restrictionSeverity("rate_limited"));
    expect(restrictionSeverity("rate_limited")).toBeLessThan(restrictionSeverity("suspended_temporary"));
    expect(restrictionSeverity("suspended_temporary")).toBeLessThan(restrictionSeverity("suspended_permanent"));
    expect(RESTRICTION_LADDER[0]).toBe("warn");
  });

  it("suggests the least severe effective action per priority", () => {
    expect(suggestedRestriction("level_1")).toBe("warn");
    expect(suggestedRestriction("level_2")).toBe("rate_limited");
    expect(suggestedRestriction("level_4")).toBe("suspended_permanent");
  });

  it("keeps interim protections reversible", () => {
    expect(isReversible("suspended_temporary")).toBe(true);
    expect(isReversible("messaging_disabled")).toBe(true);
    expect(isReversible("suspended_permanent")).toBe(false);
  });

  it("applies a suspension across every surface, no partial bypass", () => {
    for (const surface of ["messaging", "waves", "pings", "plans", "moments", "drops", "event_glow", "invite_links"]) {
      expect(SUSPENSION_BLOCKS as readonly string[]).toContain(surface);
    }
  });

  it("tells the user what happened without revealing detection internals", () => {
    const notice = restrictionNotice("suspended_temporary", "1 August");
    expect(notice).toMatch(/appeal/i);
    expect(notice).not.toMatch(/detected|algorithm|signal|score|flagged by/i);
  });
});

describe("incident response (spec §46, §47)", () => {
  it("kills proximity and collection on a suspected location exposure", () => {
    const controls = controlsForIncident("location_exposure");
    expect(controls).toContain("proximity");
    expect(controls).toContain("location_collection");
    expect(controls).toContain("event_glow");
  });

  it("forces ghost mode for location exposure, safety outranks uptime", () => {
    expect(forcesGhostMode("location_exposure")).toBe(true);
    expect(forcesGhostMode("outage")).toBe(false);
  });

  it("scopes controls narrowly for unrelated incidents", () => {
    expect(controlsForIncident("billing_compromise")).toEqual(["payments"]);
    expect(controlsForIncident("outage")).toEqual([]);
  });
});

describe("support diagnostics (spec §26, §27)", () => {
  it("keeps only safe fields, dropping anything sensitive a client sends", () => {
    const sanitized = sanitizeDiagnostics({
      app_version: "1.4.2",
      browser: "Chrome",
      // None of these may reach staff.
      exact_location: "5.6037,-0.1870",
      message_content: "private text",
      auth_token: "eyJhbGciOi",
      contact_list: "many"
    });
    expect(sanitized).toEqual({ app_version: "1.4.2", browser: "Chrome" });
    expect(JSON.stringify(sanitized)).not.toMatch(/5\.6037|private text|eyJhbGciOi/);
  });

  it("names what support must never ask a user for", () => {
    for (const item of ["password", "one_time_code", "payment_card_number", "authentication_token"]) {
      expect(NEVER_REQUEST_FROM_USER as readonly string[]).toContain(item);
    }
  });
});

describe("appeals (spec §38, §39, §40)", () => {
  it("makes significant enforcement appealable", () => {
    expect(isAppealable("suspended_permanent")).toBe(true);
    expect(isAppealable("messaging_disabled")).toBe(true);
    expect(isAppealable("warn")).toBe(false);
  });

  it("allows one appeal per action, within the window", () => {
    const base = { restriction: "suspended_temporary" as const, hasExistingAppeal: false, actionAtMs: NOW, nowMs: NOW };
    expect(resolveAppealEligibility(base)).toEqual({ allowed: true, reason: "allowed" });
    expect(resolveAppealEligibility({ ...base, hasExistingAppeal: true }).reason).toBe("already_appealed");
    expect(resolveAppealEligibility({ ...base, actionAtMs: NOW - 31 * DAY }).reason).toBe("window_closed");
  });

  it("requires a different reviewer than the original decider", () => {
    expect(canReviewAppeal({ reviewerId: "reviewer-b", originalDeciderId: "reviewer-a" })).toBe(true);
    expect(canReviewAppeal({ reviewerId: "reviewer-a", originalDeciderId: "reviewer-a" })).toBe(false);
  });
});
