import { describe, expect, it } from "vitest";
import {
  FRIENDS_NEVER_SEE,
  OPTIONAL_STEPS,
  PERMISSION_DENIED_MESSAGE,
  SAFE_DEFAULT_PRIVACY_SETUP,
  canActivateVisibility,
  canAdvanceTo,
  canCompleteOnboarding,
  glowDurationMs,
  isActivated,
  normalizePrivacySetup,
  permissionAllowsLocation,
  recommendNextAction,
  resumeStep,
  shouldEndVisibilityOnPermission,
  type Milestone,
  type OnboardingProgressState
} from "@/lib/onboarding/rules";

const NOW = Date.parse("2026-07-17T12:00:00.000Z");

describe("onboarding state machine (spec §23, §24)", () => {
  function state(overrides: Partial<OnboardingProgressState> = {}): OnboardingProgressState {
    return {
      currentStep: "not_started",
      profileCompleted: false,
      privacyReviewed: false,
      visibilityConfigured: false,
      firstMuddyAdded: false,
      ...overrides
    };
  }

  it("only moves forward, a replayed old event can't rewind progress", () => {
    expect(canAdvanceTo("profile_completed", "privacy_reviewed")).toBe(true);
    expect(canAdvanceTo("privacy_reviewed", "profile_started")).toBe(false);
    expect(canAdvanceTo("completed", "completed")).toBe(false);
  });

  it("requires profile, privacy review, and visibility choice to complete", () => {
    expect(canCompleteOnboarding(state())).toBe(false);
    expect(
      canCompleteOnboarding(state({ profileCompleted: true, privacyReviewed: true, visibilityConfigured: true }))
    ).toBe(true);
  });

  it("lets a user finish WITHOUT location or a first Muddy, neither is required", () => {
    expect(OPTIONAL_STEPS.has("location_prompted")).toBe(true);
    expect(OPTIONAL_STEPS.has("first_muddy_added")).toBe(true);
    expect(
      canCompleteOnboarding(
        state({
          profileCompleted: true,
          privacyReviewed: true,
          visibilityConfigured: true,
          firstMuddyAdded: false
        })
      )
    ).toBe(true);
  });

  it("resumes a returning user at their next incomplete step", () => {
    expect(resumeStep(state())).toBe("profile_started");
    expect(resumeStep(state({ profileCompleted: true }))).toBe("privacy_reviewed");
    expect(resumeStep(state({ profileCompleted: true, privacyReviewed: true }))).toBe("visibility_configured");
    expect(
      resumeStep(
        state({ profileCompleted: true, privacyReviewed: true, visibilityConfigured: true, firstMuddyAdded: true })
      )
    ).toBe("completed");
  });
});

describe("privacy setup defaults (spec §31)", () => {
  it("starts glow HIDDEN, visibility is never on by default", () => {
    expect(SAFE_DEFAULT_PRIVACY_SETUP.glowAudience).toBe("hidden");
  });

  it("starts online status and contact matching off", () => {
    expect(SAFE_DEFAULT_PRIVACY_SETUP.onlineStatusVisible).toBe(false);
    expect(SAFE_DEFAULT_PRIVACY_SETUP.contactMatchingEnabled).toBe(false);
  });

  it("falls back to the safe defaults for junk input", () => {
    expect(normalizePrivacySetup(null)).toEqual(SAFE_DEFAULT_PRIVACY_SETUP);
    // A malformed audience must not accidentally widen visibility.
    expect(normalizePrivacySetup({ glowAudience: "everyone" }).glowAudience).toBe("hidden");
    expect(normalizePrivacySetup({ glowAudience: "close_friends" }).glowAudience).toBe("close_friends");
  });

  it("resolves durations", () => {
    expect(glowDurationMs("1h", NOW)).toBe(60 * 60 * 1000);
    expect(glowDurationMs("until_off", NOW)).toBeNull();
    expect(glowDurationMs("until_tonight", NOW)).toBeGreaterThan(0);
  });
});

describe("permission summary honesty (spec §33)", () => {
  it("promises friends never see coordinates, distance, direction, or history", () => {
    const joined = FRIENDS_NEVER_SEE.join(" ").toLowerCase();
    expect(joined).toContain("coordinates");
    expect(joined).toContain("exact distance");
    expect(joined).toContain("direction");
    expect(joined).toContain("history");
  });
});

describe("location permission (spec §41-§48)", () => {
  it("recognizes which states permit location", () => {
    expect(permissionAllowsLocation("granted")).toBe(true);
    expect(permissionAllowsLocation("granted_approximate")).toBe(true);
    expect(permissionAllowsLocation("denied")).toBe(false);
    expect(permissionAllowsLocation("unsupported")).toBe(false);
  });

  it("never activates visibility on a client's claim alone, presence is required", () => {
    expect(
      canActivateVisibility({ audience: "close_friends", permission: "granted", hasRecentPresenceUpdate: false })
    ).toEqual({ active: false, reason: "no_presence_yet" });
    expect(
      canActivateVisibility({ audience: "close_friends", permission: "granted", hasRecentPresenceUpdate: true })
    ).toEqual({ active: true, reason: "active" });
  });

  it("never activates when the user chose hidden, even with permission and presence", () => {
    expect(
      canActivateVisibility({ audience: "hidden", permission: "granted", hasRecentPresenceUpdate: true })
    ).toEqual({ active: false, reason: "hidden_by_choice" });
  });

  it("ends visibility when permission is revoked or denied", () => {
    expect(shouldEndVisibilityOnPermission("revoked")).toBe(true);
    expect(shouldEndVisibilityOnPermission("denied_permanently")).toBe(true);
    expect(shouldEndVisibilityOnPermission("granted")).toBe(false);
  });

  it("uses non-shaming denial copy that points at what still works", () => {
    expect(PERMISSION_DENIED_MESSAGE).toMatch(/still message, create plans/);
    expect(PERMISSION_DENIED_MESSAGE).not.toMatch(/must|required|need to/i);
  });
});

describe("activation (spec §55, §57)", () => {
  it("requires a first Muddy PLUS a meaningful action, signup is not activation", () => {
    const onlyMuddy = new Set<Milestone>(["account_created", "email_verified", "first_muddy_added"]);
    expect(isActivated(onlyMuddy)).toBe(false);

    const withAction = new Set<Milestone>([...onlyMuddy, "first_wave_sent"]);
    expect(isActivated(withAction)).toBe(true);
  });

  it("does not count a filled-in form as activation", () => {
    const formOnly = new Set<Milestone>(["account_created", "profile_completed", "privacy_setup_completed"]);
    expect(isActivated(formOnly)).toBe(false);
  });

  it("recommends a Wave first, low pressure and no location needed (spec §55)", () => {
    const next = recommendNextAction({
      hasFirstMuddy: true,
      milestones: new Set<Milestone>(["first_muddy_added"]),
      hasPendingRequest: false
    });
    expect(next.id).toBe("send_wave");
    expect(next.requiresLocation).toBe(false);
  });

  it("gives a waiting user something useful instead of an empty app (spec §53)", () => {
    const next = recommendNextAction({
      hasFirstMuddy: false,
      milestones: new Set<Milestone>(),
      hasPendingRequest: true
    });
    expect(next.id).toBe("invite_another");
  });

  it("only suggests glow after the no-location actions are done", () => {
    const next = recommendNextAction({
      hasFirstMuddy: true,
      milestones: new Set<Milestone>(["first_muddy_added", "first_wave_sent", "first_status_created"]),
      hasPendingRequest: false
    });
    expect(next.id).toBe("enable_glow");
    expect(next.requiresLocation).toBe(true);
  });
});
