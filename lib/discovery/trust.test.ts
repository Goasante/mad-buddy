import { describe, expect, it } from "vitest";
import {
  DEFAULT_DISCOVERY_SETTINGS,
  accountAgeLabel,
  buildPublicTrustSummary,
  canDiscoverUser,
  effectiveRequestLimit,
  isNewAccount,
  normalizeDiscoverySettings,
  rankSearchCandidates,
  resolveSendRequest,
  resolveVerificationLevel,
  verificationBadgeLabel,
  type SearchCandidate,
  type SendRequestInput
} from "@/lib/discovery/trust";

const NOW = Date.parse("2026-07-17T12:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;

describe("discovery defaults (spec §5)", () => {
  it("keeps sensitive identifiers off until consent", () => {
    expect(DEFAULT_DISCOVERY_SETTINGS.searchableByPhone).toBe(false);
    expect(DEFAULT_DISCOVERY_SETTINGS.searchableByEmail).toBe(false);
    expect(DEFAULT_DISCOVERY_SETTINGS.searchableByUsername).toBe(true);
  });

  it("falls back to defaults for junk input", () => {
    expect(normalizeDiscoverySettings(null)).toEqual(DEFAULT_DISCOVERY_SETTINGS);
    expect(normalizeDiscoverySettings({ searchableByPhone: "yes" }).searchableByPhone).toBe(false);
    expect(normalizeDiscoverySettings({ searchableByPhone: true }).searchableByPhone).toBe(true);
  });
});

describe("canDiscoverUser (spec §2, §5)", () => {
  const base = {
    isSelf: false,
    isBlockedEitherDirection: false,
    settings: DEFAULT_DISCOVERY_SETTINGS,
    method: "username" as const
  };

  it("allows username search by default", () => {
    expect(canDiscoverUser(base).discoverable).toBe(true);
  });

  it("refuses phone/email until the user opts in", () => {
    expect(canDiscoverUser({ ...base, method: "phone" }).reason).toBe("method_disabled");
    expect(
      canDiscoverUser({
        ...base,
        method: "phone",
        settings: { ...DEFAULT_DISCOVERY_SETTINGS, searchableByPhone: true }
      }).discoverable
    ).toBe(true);
  });

  it("blocks override discovery entirely", () => {
    expect(canDiscoverUser({ ...base, isBlockedEitherDirection: true }).reason).toBe("blocked");
    // Even a token the target issued can't defeat a block.
    expect(canDiscoverUser({ ...base, method: "qr", isBlockedEitherDirection: true }).reason).toBe("blocked");
  });

  it("honours a global hide for search, but not for the user's own invite/QR", () => {
    const hidden = { ...DEFAULT_DISCOVERY_SETTINGS, hiddenFromDiscovery: true };
    expect(canDiscoverUser({ ...base, settings: hidden }).reason).toBe("hidden");
    // The target handed over the token themselves, that's consent.
    expect(canDiscoverUser({ ...base, settings: hidden, method: "invite" }).discoverable).toBe(true);
    expect(canDiscoverUser({ ...base, settings: hidden, method: "qr" }).discoverable).toBe(true);
  });
});

describe("search ranking (spec §7)", () => {
  function candidate(overrides: Partial<SearchCandidate> = {}): SearchCandidate {
    return {
      userId: "u",
      exactUsernameMatch: false,
      contactMatch: false,
      hasPendingInvite: false,
      sharedVerifiedCommunity: false,
      mutualCount: 0,
      nameSimilarity: 0,
      ...overrides
    };
  }

  it("ranks by how you know them, exact username first", () => {
    const ranked = rankSearchCandidates([
      candidate({ userId: "mutuals", mutualCount: 8 }),
      candidate({ userId: "exact", exactUsernameMatch: true }),
      candidate({ userId: "contact", contactMatch: true })
    ]);
    expect(ranked.map((entry) => entry.userId)).toEqual(["exact", "contact", "mutuals"]);
  });

  it("never lets popularity outrank a real signal, mutual count is capped", () => {
    const ranked = rankSearchCandidates([
      candidate({ userId: "popular", mutualCount: 10_000 }),
      candidate({ userId: "contact", contactMatch: true })
    ]);
    expect(ranked[0].userId).toBe("contact");
  });
});

describe("friend requests (spec §11, §16, §17)", () => {
  function send(overrides: Partial<SendRequestInput> = {}): SendRequestInput {
    return {
      isSelf: false,
      isBlockedEitherDirection: false,
      alreadyFriends: false,
      hasPendingOutgoing: false,
      hasPendingIncoming: false,
      sentToday: 0,
      dailyLimit: 20,
      ...overrides
    };
  }

  it("allows a normal request", () => {
    expect(resolveSendRequest(send())).toEqual({ allowed: true, reason: "allowed" });
  });

  it("prevents duplicates and self-requests", () => {
    expect(resolveSendRequest(send({ hasPendingOutgoing: true })).reason).toBe("duplicate_request");
    expect(resolveSendRequest(send({ isSelf: true })).reason).toBe("self");
    expect(resolveSendRequest(send({ alreadyFriends: true })).reason).toBe("already_friends");
  });

  it("flags the simultaneous-request case so the pair converges on one friendship", () => {
    expect(resolveSendRequest(send({ hasPendingIncoming: true })).reason).toBe("reciprocal_pending");
  });

  it("enforces the daily limit", () => {
    expect(resolveSendRequest(send({ sentToday: 20, dailyLimit: 20 })).reason).toBe("limit_reached");
  });

  it("caps new accounts low even on a paid plan, anti-spam beats paid limits", () => {
    expect(isNewAccount(NOW - DAY, NOW)).toBe(true);
    expect(effectiveRequestLimit({ plan: "buddy_plus", accountCreatedAtMs: NOW - DAY, nowMs: NOW })).toBe(5);
    expect(effectiveRequestLimit({ plan: "buddy_plus", accountCreatedAtMs: NOW - 30 * DAY, nowMs: NOW })).toBe(50);
    expect(effectiveRequestLimit({ plan: "free", accountCreatedAtMs: NOW - 30 * DAY, nowMs: NOW })).toBe(20);
  });
});

describe("verification levels (spec §51, §58)", () => {
  it("derives the level from verified facts", () => {
    expect(resolveVerificationLevel({ email: false, phone: false, institution: false, organisation: false })).toBeNull();
    expect(resolveVerificationLevel({ email: true, phone: false, institution: false, organisation: false })).toBe("basic");
    expect(resolveVerificationLevel({ email: true, phone: true, institution: false, organisation: false })).toBe(
      "confirmed"
    );
    expect(resolveVerificationLevel({ email: true, phone: true, institution: true, organisation: false })).toBe(
      "community_verified"
    );
    expect(resolveVerificationLevel({ email: true, phone: true, institution: true, organisation: true })).toBe(
      "official"
    );
  });

  it("never labels an ordinary account 'unverified'", () => {
    for (const level of ["basic", "confirmed", "community_verified", "official"] as const) {
      expect(verificationBadgeLabel(level)).not.toMatch(/unverified/i);
    }
  });
});

describe("account age (spec §54)", () => {
  it("uses coarse labels, never an exact timestamp", () => {
    expect(accountAgeLabel(NOW - DAY, NOW)).toBe("New account");
    expect(accountAgeLabel(NOW - 30 * DAY, NOW)).toBe("Joined this year");
    expect(accountAgeLabel(NOW - 800 * DAY, NOW)).toBe("Established account");
  });
});

describe("public trust summary (spec §57, §61)", () => {
  it("exposes only safe signals, no risk data, no timestamps", () => {
    const summary = buildPublicTrustSummary({
      verified: { email: true, phone: true, institution: true, organisation: false },
      mutualCount: 4,
      accountCreatedAtMs: NOW - 400 * DAY,
      nowMs: NOW,
      sharedCommunity: "UGBS"
    });
    expect(summary).toEqual({
      verificationLevel: "community_verified",
      badgeLabel: "University confirmed",
      mutualCount: 4,
      accountAgeLabel: "Established account",
      sharedCommunity: "UGBS"
    });
    // Nothing internal leaks into the shape.
    expect(Object.keys(summary).sort()).toEqual([
      "accountAgeLabel",
      "badgeLabel",
      "mutualCount",
      "sharedCommunity",
      "verificationLevel"
    ]);
  });
});
