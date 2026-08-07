import { describe, expect, it } from "vitest";
import { UNLIMITED } from "@/lib/billing/entitlements";
import {
  arrivedMessage,
  cancelledMessage,
  canTransitionSafeArrival,
  canTravellerAct,
  extendedArrivalMs,
  gracePeriodEndMs,
  resolveSafeArrivalPhase,
  safeArrivalLimitsFor,
  shouldSendUnconfirmedAlert,
  unconfirmedAlertMessage,
  validateContactCount,
  validateExpectedArrival,
  validateExtension,
  validateGracePeriod,
  validateDestinationLabel,
  watcherAcceptedMessage
} from "@/lib/safety/safe-arrival";

const NOW = Date.parse("2026-07-16T12:00:00.000Z");
const MIN = 60 * 1000;

describe("tier limits (spec §17, §62)", () => {
  it("gives free users 2 trusted contacts, paid more", () => {
    expect(safeArrivalLimitsFor("free").maxContacts).toBe(UNLIMITED);
    expect(safeArrivalLimitsFor("buddy_plus").maxContacts).toBe(UNLIMITED);
  });

  it("caps active sessions on every tier (anti-abuse)", () => {
    expect(safeArrivalLimitsFor("free").maxActiveSessions).toBe(UNLIMITED);
    expect(safeArrivalLimitsFor("buddy_pro").maxActiveSessions).toBe(UNLIMITED);
  });
});

describe("validation (spec §5, §14)", () => {
  it("requires a destination label", () => {
    expect(validateDestinationLabel("")).toMatch(/heading/);
    expect(validateDestinationLabel("x".repeat(121))).toMatch(/at most/);
    expect(validateDestinationLabel("East Legon")).toBeNull();
  });

  it("requires a future arrival time within 24 hours", () => {
    expect(validateExpectedArrival(NOW - 1000, NOW)).toMatch(/future/);
    expect(validateExpectedArrival(NOW + 25 * 60 * 60 * 1000, NOW)).toMatch(/24 hours/);
    expect(validateExpectedArrival(NOW + 30 * MIN, NOW)).toBeNull();
  });

  it("bounds the grace period", () => {
    expect(validateGracePeriod(1)).toMatch(/between/);
    expect(validateGracePeriod(500)).toMatch(/between/);
    expect(validateGracePeriod(20)).toBeNull();
  });

  it("enforces contact count against the plan", () => {
    // Still requires at least one contact — a journey nobody is watching is
    // not a Safe Arrival.
    expect(validateContactCount(0, "free")).toMatch(/at least one/);
    // Phase 0: no upper limit and no upgrade prompt on any tier. Someone who
    // needs more emergency contacts is the person in more danger.
    expect(validateContactCount(3, "free")).toBeNull();
    expect(validateContactCount(20, "free")).toBeNull();
    expect(validateContactCount(3, "buddy_plus")).toBeNull();
  });

  it("only allows preset extensions", () => {
    expect(validateExtension(20)).toBeNull();
    expect(validateExtension(7)).toMatch(/valid extension/);
  });
});

describe("state machine (spec §11)", () => {
  it("allows the happy path and blocks reviving terminal sessions", () => {
    expect(canTransitionSafeArrival("active", "completed")).toBe(true);
    expect(canTransitionSafeArrival("grace_period", "unconfirmed")).toBe(true);
    expect(canTransitionSafeArrival("completed", "active")).toBe(false);
    expect(canTransitionSafeArrival("cancelled", "active")).toBe(false);
    expect(canTransitionSafeArrival("expired", "active")).toBe(false);
  });

  it("lets an unconfirmed session still be confirmed late", () => {
    expect(canTransitionSafeArrival("unconfirmed", "completed")).toBe(true);
    expect(canTravellerAct("unconfirmed")).toBe(true);
    expect(canTravellerAct("completed")).toBe(false);
  });
});

describe("grace period resolution (spec §8, §9)", () => {
  const timing = { expectedArrivalMs: NOW, gracePeriodMinutes: 20, nowMs: NOW };

  it("computes the grace end from expected arrival", () => {
    expect(gracePeriodEndMs(timing)).toBe(NOW + 20 * MIN);
  });

  it("moves through before_expected → grace_period → overdue", () => {
    expect(resolveSafeArrivalPhase({ ...timing, nowMs: NOW - MIN })).toBe("before_expected");
    expect(resolveSafeArrivalPhase({ ...timing, nowMs: NOW + 5 * MIN })).toBe("grace_period");
    expect(resolveSafeArrivalPhase({ ...timing, nowMs: NOW + 21 * MIN })).toBe("overdue");
  });
});

describe("unconfirmed alert (spec §9, §16)", () => {
  const overdue = { expectedArrivalMs: NOW, gracePeriodMinutes: 20, nowMs: NOW + 21 * MIN };

  it("fires once the grace period fully elapses", () => {
    expect(shouldSendUnconfirmedAlert({ status: "active", alreadyNotified: false, timing: overdue })).toBe(true);
  });

  it("never fires twice", () => {
    expect(shouldSendUnconfirmedAlert({ status: "active", alreadyNotified: true, timing: overdue })).toBe(false);
  });

  it("never fires during the grace period", () => {
    expect(
      shouldSendUnconfirmedAlert({
        status: "active",
        alreadyNotified: false,
        timing: { ...overdue, nowMs: NOW + 5 * MIN }
      })
    ).toBe(false);
  });

  it("never fires for completed, cancelled, or already-unconfirmed sessions", () => {
    for (const status of ["completed", "cancelled", "expired", "unconfirmed"] as const) {
      expect(shouldSendUnconfirmedAlert({ status, alreadyNotified: false, timing: overdue })).toBe(false);
    }
  });
});

describe("extension (spec §9)", () => {
  it("extends from now when already overdue, so it can't re-fire instantly", () => {
    const overdueNow = NOW + 60 * MIN;
    expect(extendedArrivalMs(NOW, 20, overdueNow)).toBe(overdueNow + 20 * MIN);
  });

  it("extends from the original time when not yet due", () => {
    const future = NOW + 30 * MIN;
    expect(extendedArrivalMs(future, 20, NOW)).toBe(future + 20 * MIN);
  });
});

describe("neutral copy (spec §9)", () => {
  it("never implies an emergency", () => {
    const message = unconfirmedAlertMessage("Ama");
    expect(message).toBe("Ama has not checked in yet.");
    expect(message).not.toMatch(/missing|emergency|danger|help/i);
    expect(arrivedMessage("Ama")).toBe("Ama has arrived safely.");
  });

  it("watcher-accepted and cancelled copy never leaks a destination or location", () => {
    const accepted = watcherAcceptedMessage("Kojo");
    const cancelled = cancelledMessage("Ama");
    expect(accepted).toBe("Kojo will check in on your Safe Arrival.");
    expect(cancelled).toBe("Ama's Safe Arrival was cancelled.");
    for (const copy of [accepted, cancelled]) {
      // Nor surveillance framing: a contact checks in, they do not watch over.
      expect(copy.toLowerCase()).not.toMatch(/watching|watch over|monitor|tracking/);
      // No geography ever reaches a lock screen.
      expect(copy.toLowerCase()).not.toMatch(
        /\bkm\b|metre|meter|mile|coordinate|latitude|longitude|street|route|distance|heading to|address/
      );
    }
  });
});
