import { describe, expect, it } from "vitest";
import {
  CIRCLE_NAME_MAX_LENGTH,
  resolveFeatureAccess,
  tierLimitsFor,
  validateCircleName,
  type FeatureAccessInput
} from "@/lib/social/visibility";

const NOW = Date.parse("2026-07-16T12:00:00.000Z");

function access(overrides: Partial<FeatureAccessInput> = {}): FeatureAccessInput {
  return {
    areMutualMuddies: true,
    isBlockedEitherDirection: false,
    ownerGhostMode: false,
    ownerSuspended: false,
    viewerIsCloseFriend: false,
    viewerCircleIds: new Set(),
    viewerExplicitlyExcluded: false,
    session: null,
    nowMs: NOW,
    ...overrides
  };
}

describe("tierLimitsFor", () => {
  it("gives free users the documented caps (spec §4, §38)", () => {
    const free = tierLimitsFor("free");
    expect(free.maxPersonalCircles).toBe(3);
    expect(free.maxCircleMembers).toBe(20);
    expect(free.maxCloseFriends).toBe(8);
  });

  it("unlocks unlimited circles for paid tiers", () => {
    expect(tierLimitsFor("buddy_plus").maxPersonalCircles).toBe(Infinity);
    expect(tierLimitsFor("buddy_pro").maxCloseFriends).toBe(100);
  });
});

describe("validateCircleName", () => {
  it("rejects empty, over-long, and markup names", () => {
    expect(validateCircleName("")).toMatch(/name/);
    expect(validateCircleName("x".repeat(CIRCLE_NAME_MAX_LENGTH + 1))).toMatch(/at most/);
    expect(validateCircleName("<script>")).toMatch(/</);
  });

  it("accepts a normal name with emoji", () => {
    expect(validateCircleName("Campus Friends 🎓")).toBeNull();
  });
});

describe("resolveFeatureAccess — precedence chain (spec §24)", () => {
  it("blocks override everything", () => {
    expect(
      resolveFeatureAccess(access({ isBlockedEitherDirection: true, viewerIsCloseFriend: true })).allowed
    ).toBe(false);
  });

  it("denies non-Muddies outright", () => {
    expect(resolveFeatureAccess(access({ areMutualMuddies: false })).reason).toBe("not_muddies");
  });

  it("Ghost Mode overrides Close Friends and active sessions (spec §48)", () => {
    const result = resolveFeatureAccess(
      access({
        ownerGhostMode: true,
        viewerIsCloseFriend: true,
        session: { visibilityMode: "all_muddies", includedCircleIds: new Set(), endsAtMs: null }
      })
    );
    expect(result).toEqual({ allowed: false, reason: "ghost_mode" });
  });

  it("explicit exclusion overrides circle inclusion (spec §25)", () => {
    const result = resolveFeatureAccess(
      access({
        viewerExplicitlyExcluded: true,
        viewerCircleIds: new Set(["c1"]),
        session: { visibilityMode: "selected_circles", includedCircleIds: new Set(["c1"]), endsAtMs: null }
      })
    );
    expect(result.reason).toBe("explicitly_excluded");
  });
});

describe("resolveFeatureAccess — default (no session)", () => {
  it("allows any mutual, unblocked, non-ghosted Muddy — preserves prior behavior", () => {
    expect(resolveFeatureAccess(access()).allowed).toBe(true);
  });
});

describe("resolveFeatureAccess — audience modes", () => {
  it("hidden denies everyone", () => {
    const result = resolveFeatureAccess(
      access({ session: { visibilityMode: "hidden", includedCircleIds: new Set(), endsAtMs: null } })
    );
    expect(result).toEqual({ allowed: false, reason: "hidden" });
  });

  it("all_muddies allows any Muddy", () => {
    expect(
      resolveFeatureAccess(
        access({ session: { visibilityMode: "all_muddies", includedCircleIds: new Set(), endsAtMs: null } })
      ).allowed
    ).toBe(true);
  });

  it("close_friends allows only Close Friends", () => {
    const cf = { visibilityMode: "close_friends" as const, includedCircleIds: new Set<string>(), endsAtMs: null };
    expect(resolveFeatureAccess(access({ session: cf, viewerIsCloseFriend: true })).allowed).toBe(true);
    expect(resolveFeatureAccess(access({ session: cf, viewerIsCloseFriend: false })).reason).toBe(
      "not_in_audience"
    );
  });

  it("selected_circles allows a viewer in any included circle (overlap grants)", () => {
    const session = {
      visibilityMode: "selected_circles" as const,
      includedCircleIds: new Set(["campus"]),
      endsAtMs: null
    };
    // Viewer in campus + football; campus is included → grant applies (spec §25).
    expect(
      resolveFeatureAccess(access({ session, viewerCircleIds: new Set(["campus", "football"]) })).allowed
    ).toBe(true);
    // Viewer only in football (not included) → denied.
    expect(
      resolveFeatureAccess(access({ session, viewerCircleIds: new Set(["football"]) })).reason
    ).toBe("not_in_audience");
  });

  it("treats an expired session as no visibility", () => {
    const result = resolveFeatureAccess(
      access({
        session: {
          visibilityMode: "all_muddies",
          includedCircleIds: new Set(),
          endsAtMs: NOW - 1000
        }
      })
    );
    expect(result.reason).toBe("session_expired");
  });

  it("honors an unexpired timed session", () => {
    expect(
      resolveFeatureAccess(
        access({
          session: {
            visibilityMode: "all_muddies",
            includedCircleIds: new Set(),
            endsAtMs: NOW + 60_000
          }
        })
      ).allowed
    ).toBe(true);
  });
});
