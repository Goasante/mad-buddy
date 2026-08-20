import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  DISTANCE_TIERS,
  LINKR_COPY,
  LINKR_MINIMUM_AGE,
  isCandidateEligible,
  missingProfileRequirements,
  proximityLabel,
  rankCandidate,
  resolveDiscoverability,
  type CandidateEligibilityInput
} from "@/lib/linkr/rules";

/**
 * A candidate who passes everything. Each test breaks exactly one thing, so a
 * failure names the rule that stopped working rather than "eligibility broke".
 */
function eligibleInput(overrides: Partial<CandidateEligibilityInput> = {}): CandidateEligibilityInput {
  return {
    isSelf: false,
    blockedEitherDirection: false,
    candidateDiscoverable: true,
    viewerIntent: "friends",
    candidateIntent: "friends",
    tier: "close",
    allowedTiers: ["close", "near"],
    alreadyActedOn: false,
    alreadyConnected: false,
    presenceExpired: false,
    requirePhotos: false,
    candidateHasShowcasePhotos: true,
    onlyActiveNow: false,
    candidateActiveNow: true,
    onlyNewToday: false,
    candidateJoinedToday: true,
    eventModeActive: false,
    eventEligible: true,
    ...overrides
  };
}

describe("discoverability", () => {
  const base = {
    linkrEnabled: true,
    age: 24,
    hasPrimaryPhoto: true,
    accountVisible: true,
    restricted: false,
    deleted: false
  };

  it("allows a complete, enabled, adult profile", () => {
    expect(resolveDiscoverability(base)).toEqual({ discoverable: true, reason: "discoverable" });
  });

  it("hides someone with Linkr off", () => {
    expect(resolveDiscoverability({ ...base, linkrEnabled: false })).toEqual({
      discoverable: false,
      reason: "linkr_disabled"
    });
  });

  it("hides someone under 18", () => {
    expect(resolveDiscoverability({ ...base, age: 17 }).discoverable).toBe(false);
    expect(resolveDiscoverability({ ...base, age: 17 }).reason).toBe("underage");
  });

  it("admits exactly 18", () => {
    expect(resolveDiscoverability({ ...base, age: LINKR_MINIMUM_AGE }).discoverable).toBe(true);
    expect(resolveDiscoverability({ ...base, age: LINKR_MINIMUM_AGE - 1 }).discoverable).toBe(false);
  });

  it("FAILS CLOSED on an unknown age", () => {
    // "We do not know how old they are" must never resolve to "probably fine".
    expect(resolveDiscoverability({ ...base, age: null })).toEqual({
      discoverable: false,
      reason: "no_age"
    });
  });

  it("hides someone with no primary photo", () => {
    expect(resolveDiscoverability({ ...base, hasPrimaryPhoto: false }).reason).toBe("no_photo");
  });

  it("hides a hidden, restricted or deleted account", () => {
    expect(resolveDiscoverability({ ...base, accountVisible: false }).discoverable).toBe(false);
    expect(resolveDiscoverability({ ...base, restricted: true }).discoverable).toBe(false);
    expect(resolveDiscoverability({ ...base, deleted: true }).discoverable).toBe(false);
  });

  it("puts deletion and restriction ahead of everything else", () => {
    // A deleted account is not "Linkr disabled" -- the reason must not leak a
    // less final explanation than the truth.
    expect(resolveDiscoverability({ ...base, deleted: true, linkrEnabled: false }).reason).toBe(
      "deleted"
    );
    expect(resolveDiscoverability({ ...base, restricted: true, linkrEnabled: false }).reason).toBe(
      "restricted"
    );
  });
});

describe("profile requirements", () => {
  it("asks only for age and a main photo", () => {
    expect(missingProfileRequirements({ age: 24, hasPrimaryPhoto: true })).toEqual([]);
    expect(missingProfileRequirements({ age: null, hasPrimaryPhoto: true })).toEqual([
      "Add your date of birth"
    ]);
    expect(missingProfileRequirements({ age: 24, hasPrimaryPhoto: false })).toEqual([
      "Add a main photo"
    ]);
  });

  it("does not gate on bio or interests", () => {
    // Over-gating an early user is how a discovery product ends up empty.
    expect(missingProfileRequirements({ age: 20, hasPrimaryPhoto: true })).toHaveLength(0);
  });
});

describe("candidate eligibility", () => {
  it("admits a candidate who passes everything", () => {
    expect(isCandidateEligible(eligibleInput())).toEqual({ eligible: true, reason: "eligible" });
  });

  it("BLOCK WINS over every other signal", () => {
    // The central safety property: no combination of settings, distance,
    // intent or score lets a blocked person through.
    const verdict = isCandidateEligible(
      eligibleInput({
        blockedEitherDirection: true,
        candidateDiscoverable: true,
        tier: "close",
        allowedTiers: ["close", "near", "far"],
        viewerIntent: "anything",
        candidateIntent: "anything"
      })
    );
    expect(verdict).toEqual({ eligible: false, reason: "blocked" });
  });

  it("blocks in either direction", () => {
    // The input is symmetric on purpose: who pressed the button is irrelevant.
    expect(isCandidateEligible(eligibleInput({ blockedEitherDirection: true })).eligible).toBe(false);
  });

  it("never returns the viewer themselves", () => {
    expect(isCandidateEligible(eligibleInput({ isSelf: true })).reason).toBe("self");
  });

  it("excludes an undiscoverable candidate", () => {
    expect(isCandidateEligible(eligibleInput({ candidateDiscoverable: false })).reason).toBe(
      "not_discoverable"
    );
  });

  it("excludes incompatible intents", () => {
    expect(
      isCandidateEligible(eligibleInput({ viewerIntent: "friends", candidateIntent: "dating" })).reason
    ).toBe("intent_mismatch");
    expect(
      isCandidateEligible(eligibleInput({ viewerIntent: "dating", candidateIntent: "friends" })).reason
    ).toBe("intent_mismatch");
  });

  it("excludes a candidate outside the chosen distance", () => {
    expect(
      isCandidateEligible(eligibleInput({ tier: "far", allowedTiers: ["close", "near"] })).reason
    ).toBe("out_of_range");
    expect(
      isCandidateEligible(eligibleInput({ tier: "far", allowedTiers: ["close", "near", "far"] })).eligible
    ).toBe(true);
  });

  it("excludes someone already passed or connected with", () => {
    expect(isCandidateEligible(eligibleInput({ alreadyActedOn: true })).reason).toBe("already_acted");
    expect(isCandidateEligible(eligibleInput({ alreadyConnected: true })).reason).toBe(
      "already_connected"
    );
  });

  it("excludes someone whose presence has gone stale", () => {
    // Their session may still be live, but "nearby" would be a claim about a
    // device that stopped reporting.
    expect(isCandidateEligible(eligibleInput({ presenceExpired: true })).reason).toBe(
      "presence_expired"
    );
  });

  describe("optional filters", () => {
    it("applies Has photos", () => {
      expect(
        isCandidateEligible(
          eligibleInput({ requirePhotos: true, candidateHasShowcasePhotos: false })
        ).reason
      ).toBe("filtered_photos");
      expect(
        isCandidateEligible(eligibleInput({ requirePhotos: true, candidateHasShowcasePhotos: true }))
          .eligible
      ).toBe(true);
    });

    it("applies Online now", () => {
      expect(
        isCandidateEligible(eligibleInput({ onlyActiveNow: true, candidateActiveNow: false })).reason
      ).toBe("filtered_active");
    });

    it("applies New today", () => {
      expect(
        isCandidateEligible(eligibleInput({ onlyNewToday: true, candidateJoinedToday: false })).reason
      ).toBe("filtered_new");
    });

    it("never lets a filter be the thing that ADMITS somebody", () => {
      // Filters narrow. Turning every filter on cannot rescue a blocked or
      // ineligible candidate, and turning them off cannot either.
      const blocked = { blockedEitherDirection: true };
      for (const filters of [
        { requirePhotos: true, onlyActiveNow: true, onlyNewToday: true },
        { requirePhotos: false, onlyActiveNow: false, onlyNewToday: false }
      ]) {
        expect(isCandidateEligible(eligibleInput({ ...blocked, ...filters })).eligible).toBe(false);
      }
    });
  });

  describe("Event Mode", () => {
    it("requires Event eligibility on top of ordinary eligibility", () => {
      expect(
        isCandidateEligible(eligibleInput({ eventModeActive: true, eventEligible: false })).reason
      ).toBe("not_event_eligible");
      expect(
        isCandidateEligible(eligibleInput({ eventModeActive: true, eventEligible: true })).eligible
      ).toBe(true);
    });

    it("NARROWS ONLY -- Event eligibility cannot rescue an ineligible candidate", () => {
      // This is the whole safety argument for layering Event Mode on top of
      // the canonical gate instead of inside it.
      for (const breaker of [
        { blockedEitherDirection: true },
        { candidateDiscoverable: false },
        { viewerIntent: "friends" as const, candidateIntent: "dating" as const },
        { tier: "far" as const, allowedTiers: ["close"] as const },
        { alreadyConnected: true }
      ]) {
        expect(
          isCandidateEligible(
            eligibleInput({ eventModeActive: true, eventEligible: true, ...breaker })
          ).eligible
        ).toBe(false);
      }
    });

    it("ignores Event eligibility when Event Mode is off", () => {
      expect(
        isCandidateEligible(eligibleInput({ eventModeActive: false, eventEligible: false })).eligible
      ).toBe(true);
    });
  });
});

describe("distance and proximity presentation", () => {
  it("maps preferences to tiers, widening monotonically", () => {
    expect(DISTANCE_TIERS.very_close).toEqual(["close"]);
    expect(DISTANCE_TIERS.around_you).toEqual(["close", "near"]);
    expect(DISTANCE_TIERS.wider).toEqual(["close", "near", "far"]);

    // Each step is a superset of the one before: widening never removes
    // somebody who was already visible.
    expect(DISTANCE_TIERS.around_you).toEqual(expect.arrayContaining([...DISTANCE_TIERS.very_close]));
    expect(DISTANCE_TIERS.wider).toEqual(expect.arrayContaining([...DISTANCE_TIERS.around_you]));
  });

  it("emits broad labels and NEVER a number", () => {
    const labels = [
      proximityLabel("close", false),
      proximityLabel("near", false),
      proximityLabel("far", false),
      proximityLabel("close", true),
      proximityLabel("near", true),
      proximityLabel("far", true)
    ];
    for (const label of labels) {
      expect(label).not.toMatch(/\d/);
      expect(label).not.toMatch(/\b(km|m|mi|meters?|metres?|miles?|away)\b/i);
    }
  });

  it("uses Event wording in Event Mode", () => {
    expect(proximityLabel("close", true)).toBe("Here too");
    expect(proximityLabel("close", false)).toBe("Very close");
  });
});

describe("ranking", () => {
  const base = {
    tier: "near" as const,
    sharedInterests: 0,
    intentExactMatch: false,
    photoCount: 1,
    hasBio: false,
    activeNow: false,
    joinedRecently: false
  };

  it("prefers nearer people, all else equal", () => {
    expect(rankCandidate({ ...base, tier: "close" })).toBeGreaterThan(
      rankCandidate({ ...base, tier: "near" })
    );
    expect(rankCandidate({ ...base, tier: "near" })).toBeGreaterThan(
      rankCandidate({ ...base, tier: "far" })
    );
  });

  it("rewards shared interests, and caps the reward", () => {
    expect(rankCandidate({ ...base, sharedInterests: 3 })).toBeGreaterThan(rankCandidate(base));
    // Uncapped, a tag-stuffed profile would dominate every deck.
    expect(rankCandidate({ ...base, sharedInterests: 50 })).toBe(
      rankCandidate({ ...base, sharedInterests: 5 })
    );
  });

  it("rewards a fuller profile and real activity", () => {
    expect(rankCandidate({ ...base, photoCount: 4 })).toBeGreaterThan(rankCandidate(base));
    expect(rankCandidate({ ...base, hasBio: true })).toBeGreaterThan(rankCandidate(base));
    expect(rankCandidate({ ...base, activeNow: true })).toBeGreaterThan(rankCandidate(base));
    expect(rankCandidate({ ...base, intentExactMatch: true })).toBeGreaterThan(rankCandidate(base));
  });

  it("is deterministic", () => {
    // No randomness, no time dependence: the same candidate scores the same
    // twice, which is what makes the ordering explainable.
    expect(rankCandidate(base)).toBe(rankCandidate(base));
  });
});

describe("copy", () => {
  it("centralises the strings the board specifies", () => {
    expect(LINKR_COPY.matchTitle).toBe("You clicked!");
    expect(LINKR_COPY.matchBody("Ama")).toBe("You and Ama both want to connect.");
    expect(LINKR_COPY.emptyTitle).toBe("No one nearby right now");
    expect(LINKR_COPY.connectedAtEvent("AfroFuture Night")).toBe("Connected at AfroFuture Night");
  });

  it("never promises an exact location", () => {
    expect(LINKR_COPY.offPrivacy).toMatch(/never/i);
    const allCopy = JSON.stringify(LINKR_COPY);
    expect(allCopy).not.toMatch(/\b\d+\s?(km|miles|m)\b/i);
  });
});

describe("migration invariants", () => {
  const migration = readFileSync(
    resolve(process.cwd(), "supabase/migrations/20260818130000_linkr_2_foundation.sql"),
    "utf8"
  );

  it("keeps linkr_record_connect callable by the SERVER and nobody else", () => {
    /**
     * REGRESSION. The revokes below are what stop a client using this function
     * as a reciprocity oracle -- call it with any user id and the return value
     * says whether that person had already connected with you.
     *
     * But `revoke ... from public` also strips service_role's INHERITED grant,
     * which silently broke every Connect in the running app with "permission
     * denied for function". The explicit grant back is therefore load-bearing,
     * and its absence is not visible in any type or unit test -- only at
     * runtime, on the one action the product exists for.
     */
    expect(migration).toContain(
      "revoke all on function public.linkr_record_connect(uuid, uuid, uuid) from public;"
    );
    expect(migration).toContain(
      "revoke all on function public.linkr_record_connect(uuid, uuid, uuid) from anon;"
    );
    expect(migration).toContain(
      "revoke all on function public.linkr_record_connect(uuid, uuid, uuid) from authenticated;"
    );
    expect(migration).toContain(
      "grant execute on function public.linkr_record_connect(uuid, uuid, uuid) to service_role;"
    );
  });

  it("never grants a recipient read access to linkr_actions", () => {
    // A policy with `target_id = auth.uid()` would let somebody enumerate who
    // is interested in them, which is the one thing this table protects.
    expect(migration).not.toMatch(/on public\.linkr_actions[\s\S]{0,200}target_id = auth\.uid\(\)/);
    expect(migration).toContain('for select using (actor_id = auth.uid())');
  });

  it("gives linkr_connections no client INSERT policy", () => {
    // Connections are created only by linkr_record_connect. An insert policy
    // would let anyone manufacture a match with a stranger.
    expect(migration).not.toMatch(/on public\.linkr_connections\s+for insert/);
  });

  it("keeps the pair ordering constraint that makes a duplicate impossible", () => {
    expect(migration).toContain("constraint linkr_connections_ordered check (user_low < user_high)");
    expect(migration).toContain("constraint linkr_connections_unique unique (user_low, user_high)");
    expect(migration).toContain("constraint linkr_actions_unique unique (actor_id, target_id)");
  });

  it("stores no coordinate or radius column anywhere in Linkr", () => {
    // A numeric radius column is the thing a future change would render as a
    // distance. There must not be one to render.
    expect(migration).not.toMatch(/\b(latitude|longitude|radius_m|distance_m|radius_km)\b/);
  });
});
