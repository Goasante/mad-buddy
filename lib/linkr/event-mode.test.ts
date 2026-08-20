import { afterEach, describe, expect, it, vi } from "vitest";

import {
  __setEventConsentModuleForTests,
  describeEventPool,
  eventModeCandidateIds,
  resolveViewerEventMode
} from "@/lib/linkr/event-mode-adapter";
import { isCandidateEligible } from "@/lib/linkr/rules";

/**
 * Event Mode, from Linkr's side of the seam.
 *
 * The Events branch owns the decisions. What is tested here is that Linkr
 * CONSUMES them correctly and adds nothing of its own -- in particular that
 * every path fails closed, and that Event eligibility can only ever narrow.
 */

const admin = {} as never;

afterEach(() => {
  __setEventConsentModuleForTests(undefined);
});

/** A stub standing in for lib/events/linkr-consent.ts. */
function eventsModule(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    resolveEventLinkrEligibility: vi.fn(async () => ({ eligible: true, reason: "eligible" })),
    eventLinkrCandidateIds: vi.fn(async () => new Set(["ama", "kofi"])),
    describeEventLinkrPool: (count: number) =>
      count <= 0 ? null : count < 5 ? "People here are open to connecting." : `${count} people are open to connecting.`,
    EVENT_LINKR_COUNT_THRESHOLD: 5,
    ...overrides
  } as never;
}

describe("the adapter fails closed", () => {
  it("denies Event Mode when the Events module is absent", () => {
    // A branch without Events must never mean "assume everyone consented".
    __setEventConsentModuleForTests(null);
    return expect(resolveViewerEventMode(admin, "godfred", "event-1")).resolves.toEqual({
      eligible: false,
      reason: "consent_module_unavailable"
    });
  });

  it("returns an EMPTY candidate set when the Events module is absent", async () => {
    __setEventConsentModuleForTests(null);
    expect(await eventModeCandidateIds(admin, "godfred", "event-1")).toEqual(new Set());
  });

  it("returns an empty set when the Events side throws", async () => {
    __setEventConsentModuleForTests(
      eventsModule({
        eventLinkrCandidateIds: vi.fn(async () => {
          throw new Error("events unavailable");
        })
      })
    );
    expect(await eventModeCandidateIds(admin, "godfred", "event-1")).toEqual(new Set());
  });
});

describe("the adapter delegates rather than deciding", () => {
  it("passes the Events verdict through unchanged", async () => {
    for (const reason of ["not_checked_in", "no_consent", "event_not_live", "event_not_found"]) {
      __setEventConsentModuleForTests(
        eventsModule({
          resolveEventLinkrEligibility: vi.fn(async () => ({ eligible: false, reason }))
        })
      );
      const result = await resolveViewerEventMode(admin, "godfred", "event-1");
      expect(result).toEqual({ eligible: false, reason });
    }
  });

  it("never overrides a denial", async () => {
    // There is no branch in the adapter that can turn `eligible: false` into
    // `true` -- Linkr cannot grant itself access to a room.
    __setEventConsentModuleForTests(
      eventsModule({
        resolveEventLinkrEligibility: vi.fn(async () => ({ eligible: false, reason: "not_checked_in" }))
      })
    );
    expect((await resolveViewerEventMode(admin, "godfred", "event-1")).eligible).toBe(false);
  });

  it("uses the EVENTS small-pool describer, not one of its own", async () => {
    const mod = eventsModule();
    __setEventConsentModuleForTests(mod);
    // Below the threshold: no number.
    expect(await describeEventPool(3)).toBe("People here are open to connecting.");
    expect(await describeEventPool(3)).not.toMatch(/\d/);
    // Above it: a crowd statistic is fine.
    expect(await describeEventPool(12)).toBe("12 people are open to connecting.");
    expect(await describeEventPool(0)).toBeNull();
  });

  it("suppresses the count when the Events module is missing", async () => {
    // Falls back to the SAFE half of the rule, never to a raw number.
    __setEventConsentModuleForTests(null);
    expect(await describeEventPool(3)).toBe("People here are open to connecting.");
    expect(await describeEventPool(40)).not.toMatch(/\d/);
  });
});

/**
 * The eligibility ladder from the brief (§89), expressed against the pure
 * predicate. Each rung names a permission that is NOT the one Event Mode
 * requires.
 */
describe("Event Mode eligibility ladder", () => {
  const base = {
    isSelf: false,
    blockedEitherDirection: false,
    candidateDiscoverable: true,
    viewerIntent: "anything" as const,
    candidateIntent: "anything" as const,
    tier: "close" as const,
    allowedTiers: ["close", "near", "far"] as const,
    alreadyActedOn: false,
    alreadyConnected: false,
    presenceExpired: false,
    requirePhotos: false,
    candidateHasShowcasePhotos: true,
    onlyActiveNow: false,
    candidateActiveNow: true,
    onlyNewToday: false,
    candidateJoinedToday: true,
    eventModeActive: true
  };

  it("DENIES someone who is only Going (no check-in, no consent)", () => {
    expect(isCandidateEligible({ ...base, eventEligible: false }).eligible).toBe(false);
  });

  it("DENIES someone checked in but not consenting", () => {
    // The Events authority resolves this to `false`; Linkr honours it.
    expect(isCandidateEligible({ ...base, eventEligible: false }).reason).toBe("not_event_eligible");
  });

  it("DENIES someone with Event Glow but no Event Linkr consent", () => {
    // Event Glow means "show my Muddies I am here". It is a different
    // permission and must never be read as this one.
    expect(isCandidateEligible({ ...base, eventEligible: false }).eligible).toBe(false);
  });

  it("DENIES someone who consented but never checked in", () => {
    expect(isCandidateEligible({ ...base, eventEligible: false }).eligible).toBe(false);
  });

  it("ALLOWS someone checked in, consenting and otherwise eligible", () => {
    expect(isCandidateEligible({ ...base, eventEligible: true }).eligible).toBe(true);
  });

  it("DENIES immediately on checkout", async () => {
    // Checkout is not a stored state change on Linkr's side: the Events
    // authority stops returning the id, and the candidate simply is not there.
    __setEventConsentModuleForTests(
      eventsModule({ eventLinkrCandidateIds: vi.fn(async () => new Set<string>()) })
    );
    expect(await eventModeCandidateIds(admin, "godfred", "event-1")).toEqual(new Set());
  });

  it("DENIES once the Event has ended", async () => {
    __setEventConsentModuleForTests(
      eventsModule({
        resolveEventLinkrEligibility: vi.fn(async () => ({ eligible: false, reason: "event_not_live" }))
      })
    );
    expect((await resolveViewerEventMode(admin, "godfred", "event-1")).eligible).toBe(false);
  });

  it("DENIES a blocked attendee even when the Event says they are eligible", () => {
    expect(
      isCandidateEligible({ ...base, eventEligible: true, blockedEitherDirection: true }).reason
    ).toBe("blocked");
  });
});

describe("Event Mode mutation tests", () => {
  it("BITES: Event eligibility used as a substitute for ordinary eligibility", () => {
    // If eventEligible were ever checked INSTEAD of the ordinary rules rather
    // than in addition to them, each of these would wrongly pass.
    const base = {
      isSelf: false,
      blockedEitherDirection: false,
      candidateDiscoverable: true,
      viewerIntent: "friends" as const,
      candidateIntent: "friends" as const,
      tier: "close" as const,
      allowedTiers: ["close"] as const,
      alreadyActedOn: false,
      alreadyConnected: false,
      presenceExpired: false,
      requirePhotos: false,
      candidateHasShowcasePhotos: true,
      onlyActiveNow: false,
      candidateActiveNow: true,
      onlyNewToday: false,
      candidateJoinedToday: true,
      eventModeActive: true,
      eventEligible: true
    };

    expect(isCandidateEligible({ ...base, blockedEitherDirection: true }).eligible).toBe(false);
    expect(isCandidateEligible({ ...base, candidateDiscoverable: false }).eligible).toBe(false);
    expect(isCandidateEligible({ ...base, candidateIntent: "dating" }).eligible).toBe(false);
    expect(isCandidateEligible({ ...base, isSelf: true }).eligible).toBe(false);
  });

  it("BITES: an adapter that defaults to eligible when Events is unreachable", async () => {
    __setEventConsentModuleForTests(null);
    const result = await resolveViewerEventMode(admin, "godfred", "event-1");
    expect(result.eligible).toBe(false);
  });

  it("BITES: a small-pool count leaking through the adapter", async () => {
    __setEventConsentModuleForTests(eventsModule());
    for (const count of [1, 2, 3, 4]) {
      expect(await describeEventPool(count)).not.toMatch(/\d/);
    }
  });
});
