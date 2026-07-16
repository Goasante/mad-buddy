import { describe, expect, it } from "vitest";
import {
  canTransitionHangout,
  canTransitionPlan,
  isHangoutJoinable,
  isRsvpChoice,
  planTierLimitsFor,
  resolvePollWinner,
  resolveRsvp,
  validateHangoutDuration,
  validatePlanTiming,
  validatePlanTitle,
  validatePollOptions,
  type RsvpAttempt
} from "@/lib/social/plans";

const NOW = Date.parse("2026-07-16T12:00:00.000Z");

describe("planTierLimitsFor", () => {
  it("gives free users the documented caps (spec §11)", () => {
    const free = planTierLimitsFor("free");
    expect(free.maxActivePlans).toBe(5);
    expect(free.maxPlanParticipants).toBe(10);
    expect(free.maxPollsPerPlan).toBe(1);
    expect(free.maxHangoutCapacity).toBe(5);
  });

  it("unlocks larger plans for paid tiers", () => {
    expect(planTierLimitsFor("buddy_plus").maxPlanParticipants).toBe(50);
    expect(planTierLimitsFor("buddy_pro").maxPlanParticipants).toBe(500);
    expect(planTierLimitsFor("buddy_plus").maxActivePlans).toBe(Infinity);
  });
});

describe("validation", () => {
  it("rejects empty and over-long titles", () => {
    expect(validatePlanTitle("")).toMatch(/title/);
    expect(validatePlanTitle("x".repeat(81))).toMatch(/at most/);
    expect(validatePlanTitle("Lunch after class")).toBeNull();
  });

  it("requires a future start for scheduled plans", () => {
    expect(
      validatePlanTiming({ planType: "scheduled", startAtMs: null, endAtMs: null, nowMs: NOW })
    ).toMatch(/date and time/);
    expect(
      validatePlanTiming({ planType: "scheduled", startAtMs: NOW - 1000, endAtMs: null, nowMs: NOW })
    ).toMatch(/future/);
    expect(
      validatePlanTiming({ planType: "scheduled", startAtMs: NOW + 1000, endAtMs: null, nowMs: NOW })
    ).toBeNull();
  });

  it("lets quick and poll plans defer timing", () => {
    expect(
      validatePlanTiming({ planType: "quick", startAtMs: null, endAtMs: null, nowMs: NOW })
    ).toBeNull();
    expect(
      validatePlanTiming({ planType: "poll", startAtMs: null, endAtMs: null, nowMs: NOW })
    ).toBeNull();
  });

  it("rejects an end before start", () => {
    expect(
      validatePlanTiming({ planType: "scheduled", startAtMs: NOW + 2000, endAtMs: NOW + 1000, nowMs: NOW })
    ).toMatch(/end time/);
  });

  it("enforces poll option count and uniqueness", () => {
    expect(validatePollOptions(["Only one"])).toMatch(/at least/);
    expect(validatePollOptions(["a", "b", "c", "d", "e", "f", "g"])).toMatch(/at most/);
    expect(validatePollOptions(["Library", "library"])).toMatch(/different/);
    expect(validatePollOptions(["Library", "Café"])).toBeNull();
  });

  it("bounds hangout duration", () => {
    expect(validateHangoutDuration(NOW, NOW)).toMatch(/after the start/);
    expect(validateHangoutDuration(NOW, NOW + 13 * 60 * 60 * 1000)).toMatch(/12 hours/);
    expect(validateHangoutDuration(NOW, NOW + 2 * 60 * 60 * 1000)).toBeNull();
  });
});

describe("plan state machine (spec §7)", () => {
  it("allows the scheduled happy path and blocks skips", () => {
    expect(canTransitionPlan("inviting", "confirmed")).toBe(true);
    expect(canTransitionPlan("confirmed", "completed")).toBe(true);
    expect(canTransitionPlan("draft", "completed")).toBe(false);
  });

  it("treats cancelled/completed/expired as terminal", () => {
    expect(canTransitionPlan("cancelled", "inviting")).toBe(false);
    expect(canTransitionPlan("completed", "confirmed")).toBe(false);
    expect(canTransitionPlan("expired", "confirmed")).toBe(false);
  });
});

describe("RSVP resolution (spec §23, §26, §30)", () => {
  function attempt(overrides: Partial<RsvpAttempt> = {}): RsvpAttempt {
    return {
      currentStatus: "invited",
      desired: "going",
      planStatus: "inviting",
      rsvpDeadlineMs: null,
      nowMs: NOW,
      goingCount: 0,
      maxParticipants: 10,
      ...overrides
    };
  }

  it("accepts a going response with seats available", () => {
    expect(resolveRsvp(attempt())).toEqual({ allowed: true, status: "going", waitlisted: false });
  });

  it("waitlists going when capacity is full (spec §26)", () => {
    const decision = resolveRsvp(attempt({ goingCount: 10, maxParticipants: 10 }));
    expect(decision).toEqual({ allowed: true, status: "going", waitlisted: true });
  });

  it("keeps a seat a participant already holds even when 'full'", () => {
    const decision = resolveRsvp(
      attempt({ currentStatus: "going", goingCount: 10, maxParticipants: 10 })
    );
    expect(decision).toEqual({ allowed: true, status: "going", waitlisted: false });
  });

  it("blocks a removed participant", () => {
    expect(resolveRsvp(attempt({ currentStatus: "removed" }))).toEqual({
      allowed: false,
      reason: "removed"
    });
  });

  it("blocks responses to a cancelled plan", () => {
    expect(resolveRsvp(attempt({ planStatus: "cancelled" }))).toEqual({
      allowed: false,
      reason: "plan_closed"
    });
  });

  it("enforces the deadline for commitments but still lets you back out", () => {
    expect(resolveRsvp(attempt({ desired: "going", rsvpDeadlineMs: NOW - 1 })).allowed).toBe(false);
    // Can't-make-it after the deadline is still allowed.
    expect(
      resolveRsvp(attempt({ desired: "not_going", rsvpDeadlineMs: NOW - 1 }))
    ).toEqual({ allowed: true, status: "not_going", waitlisted: false });
  });

  it("recognizes valid RSVP choices", () => {
    expect(isRsvpChoice("going")).toBe(true);
    expect(isRsvpChoice("attended")).toBe(false);
  });
});

describe("poll winner logic (spec §36)", () => {
  it("returns a clear plurality winner", () => {
    const result = resolvePollWinner([
      { optionId: "a", votes: 3 },
      { optionId: "b", votes: 1 }
    ]);
    expect(result).toEqual({ resolved: true, winnerId: "a", tieBroken: false });
  });

  it("reports no winner when there are no votes", () => {
    expect(resolvePollWinner([{ optionId: "a", votes: 0 }]).resolved).toBe(false);
  });

  it("defers a tie to the host by default", () => {
    const result = resolvePollWinner([
      { optionId: "a", votes: 2 },
      { optionId: "b", votes: 2 }
    ]);
    expect(result).toEqual({ resolved: false, reason: "tie", tiedOptionIds: ["a", "b"] });
  });

  it("breaks a time-poll tie by choosing the earliest option", () => {
    const result = resolvePollWinner(
      [
        { optionId: "late", votes: 2, sortValue: "2026-07-17T18:00:00Z" },
        { optionId: "early", votes: 2, sortValue: "2026-07-17T13:00:00Z" }
      ],
      "earliest"
    );
    expect(result).toEqual({ resolved: true, winnerId: "early", tieBroken: true });
  });
});

describe("hangout state machine (spec §50)", () => {
  it("allows active→converted and blocks terminal transitions", () => {
    expect(canTransitionHangout("active", "converted_to_plan")).toBe(true);
    expect(canTransitionHangout("full", "active")).toBe(true);
    expect(canTransitionHangout("converted_to_plan", "active")).toBe(false);
    expect(canTransitionHangout("expired", "active")).toBe(false);
  });

  it("is joinable only while active and unexpired", () => {
    expect(isHangoutJoinable("active", NOW + 1000, NOW)).toBe(true);
    expect(isHangoutJoinable("active", NOW - 1000, NOW)).toBe(false);
    expect(isHangoutJoinable("paused", NOW + 1000, NOW)).toBe(false);
  });
});
