import { describe, expect, it } from "vitest";
import {
  audienceSummaryLabel,
  contentTierLimitsFor,
  expiryMsForPreset,
  isMomentLive,
  resolveDropUnlock,
  resolveMomentVisibility,
  validateExpiry,
  validateMomentContent,
  type DropUnlockInput,
  type MomentVisibilityInput
} from "@/lib/content/moments";

const NOW = Date.parse("2026-07-17T12:00:00.000Z");
const HOUR = 60 * 60 * 1000;

describe("tier limits (spec §16, §32)", () => {
  it("gives free users the documented caps", () => {
    const free = contentTierLimitsFor("free");
    expect(free.maxActiveMomentsPerDay).toBe(5);
    expect(free.maxActiveNearbyMoments).toBe(5);
    expect(free.maxActiveDrops).toBe(3);
    expect(free.allowEventDrops).toBe(false);
  });

  it("unlocks more for paid tiers", () => {
    expect(contentTierLimitsFor("buddy_plus").maxActiveMomentsPerDay).toBe(20);
    expect(contentTierLimitsFor("buddy_plus").allowEventDrops).toBe(true);
  });
});

describe("content + expiry validation (spec §3, §8)", () => {
  it("requires text for a text moment and media for a photo moment", () => {
    expect(validateMomentContent({ contentType: "text", textContent: "  ", mediaId: null, caption: null })).toMatch(
      /Write something/
    );
    expect(validateMomentContent({ contentType: "photo", textContent: null, mediaId: null, caption: null })).toMatch(
      /photo/
    );
    expect(
      validateMomentContent({ contentType: "photo", textContent: null, mediaId: "m1", caption: "hi" })
    ).toBeNull();
  });

  it("bounds text and caption length", () => {
    expect(
      validateMomentContent({ contentType: "text", textContent: "x".repeat(501), mediaId: null, caption: null })
    ).toMatch(/at most/);
    expect(
      validateMomentContent({ contentType: "text", textContent: "ok", mediaId: null, caption: "x".repeat(201) })
    ).toMatch(/Captions/);
  });

  it("requires a future expiry within 24 hours, everything expires", () => {
    expect(validateExpiry(NOW - 1, NOW)).toMatch(/future/);
    expect(validateExpiry(NOW + 25 * HOUR, NOW)).toMatch(/24 hours/);
    expect(validateExpiry(NOW + 6 * HOUR, NOW)).toBeNull();
    expect(expiryMsForPreset("6h")).toBe(6 * HOUR);
  });

  it("treats an expired moment as not live", () => {
    expect(isMomentLive("active", NOW + HOUR, NOW)).toBe(true);
    expect(isMomentLive("active", NOW - 1, NOW)).toBe(false);
    expect(isMomentLive("removed", NOW + HOUR, NOW)).toBe(false);
  });
});

describe("moment visibility (spec §5, §15)", () => {
  function view(overrides: Partial<MomentVisibilityInput> = {}): MomentVisibilityInput {
    return {
      isAuthor: false,
      status: "active",
      expiresAtMs: NOW + HOUR,
      nowMs: NOW,
      areApprovedMuddies: true,
      isBlockedEitherDirection: false,
      authorGhostMode: false,
      viewerHidThis: false,
      audienceType: "selected_circles",
      viewerInAudience: true,
      viewerNearbyAndFresh: false,
      ...overrides
    };
  }

  it("shows an eligible audience member", () => {
    expect(resolveMomentVisibility(view())).toEqual({ visible: true, reason: "visible" });
  });

  it("always shows the author their own moment", () => {
    expect(resolveMomentVisibility(view({ isAuthor: true, authorGhostMode: true, status: "removed" })).visible).toBe(
      true
    );
  });

  it("blocks override everything", () => {
    expect(resolveMomentVisibility(view({ isBlockedEitherDirection: true })).reason).toBe("blocked");
  });

  it("hides from non-Muddies and expired/removed content", () => {
    expect(resolveMomentVisibility(view({ areApprovedMuddies: false })).reason).toBe("not_muddies");
    expect(resolveMomentVisibility(view({ expiresAtMs: NOW - 1 })).reason).toBe("expired");
    expect(resolveMomentVisibility(view({ status: "removed" })).reason).toBe("not_active");
  });

  it("respects report-and-hide for that viewer only", () => {
    expect(resolveMomentVisibility(view({ viewerHidThis: true })).reason).toBe("hidden_by_viewer");
  });

  it("Ghost Mode hides the author's moments", () => {
    expect(resolveMomentVisibility(view({ authorGhostMode: true })).reason).toBe("ghost_mode");
  });

  it("requires audience membership", () => {
    expect(resolveMomentVisibility(view({ viewerInAudience: false })).reason).toBe("not_in_audience");
  });

  it("nearby audience needs a fresh in-band presence, not just friendship", () => {
    const nearby = view({ audienceType: "nearby_muddies", viewerInAudience: true });
    expect(resolveMomentVisibility({ ...nearby, viewerNearbyAndFresh: false }).reason).toBe("not_nearby");
    expect(resolveMomentVisibility({ ...nearby, viewerNearbyAndFresh: true }).visible).toBe(true);
  });
});

describe("drop unlock (spec §25, §33)", () => {
  function unlock(overrides: Partial<DropUnlockInput> = {}): DropUnlockInput {
    return {
      status: "active",
      startsAtMs: NOW - HOUR,
      expiresAtMs: NOW + HOUR,
      nowMs: NOW,
      areApprovedMuddiesWithCreator: true,
      isBlockedEitherDirection: false,
      viewerInContext: true,
      contextValid: true,
      alreadyUnlocked: false,
      unlockCount: 0,
      maxUnlocks: null,
      ...overrides
    };
  }

  it("allows an eligible unlock", () => {
    expect(resolveDropUnlock(unlock())).toEqual({ allowed: true, reason: "allowed" });
  });

  it("treats a duplicate unlock as allowed, not an error", () => {
    expect(resolveDropUnlock(unlock({ alreadyUnlocked: true }))).toEqual({
      allowed: true,
      reason: "already_unlocked"
    });
  });

  it("refuses users outside the context, and invalid contexts", () => {
    expect(resolveDropUnlock(unlock({ viewerInContext: false })).reason).toBe("not_in_context");
    expect(resolveDropUnlock(unlock({ contextValid: false })).reason).toBe("context_invalid");
  });

  it("respects timing and the unlock cap", () => {
    expect(resolveDropUnlock(unlock({ startsAtMs: NOW + HOUR })).reason).toBe("not_started");
    expect(resolveDropUnlock(unlock({ expiresAtMs: NOW - 1 })).reason).toBe("expired");
    expect(resolveDropUnlock(unlock({ maxUnlocks: 5, unlockCount: 5 })).reason).toBe("unlock_limit_reached");
  });

  it("blocks and non-Muddies never unlock", () => {
    expect(resolveDropUnlock(unlock({ isBlockedEitherDirection: true })).reason).toBe("blocked");
    expect(resolveDropUnlock(unlock({ areApprovedMuddiesWithCreator: false })).reason).toBe("not_muddies");
  });
});

describe("privacy summary copy (spec §7)", () => {
  it("describes the audience without implying exact location", () => {
    expect(audienceSummaryLabel("nearby_muddies", [])).toBe("Approved Muddies who are nearby");
    expect(audienceSummaryLabel("selected_circles", ["Campus Friends"])).toBe("Campus Friends");
    expect(audienceSummaryLabel("close_friends", [])).toBe("Close Friends");
  });
});
