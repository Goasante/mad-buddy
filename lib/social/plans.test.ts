import { describe, expect, it } from "vitest";
import {
  canTransitionHangout,
  canTransitionPlan,
  isArchivedUnscheduledPlan,
  isHangoutJoinable,
  isPastPlan,
  isRsvpChoice,
  isUnscheduledPlan,
  isUpcomingPlan,
  planPhase,
  planTierLimitsFor,
  resolvePollWinner,
  PLAN_DEFAULT_ACTIVE_MS,
  PLAN_NEAR_START_MS,
  resolveRsvp,
  unscheduledDeadlineMs,
  UNSCHEDULED_PLAN_GRACE_DAYS,
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

/**
 * The canonical plan lifecycle.
 *
 * REPLACES an assertion that read `isPastPlan("inviting", null, NOW) === false`
 * -- an undated plan is never past. That was written alongside the helper and
 * described what the code did rather than a decided product rule: nothing in
 * the schema, the specs or docs/ ever called permanent-TBD intentional, and
 * the visible result was nine undated plans sitting in Upcoming across six
 * accounts, the oldest 23 days old. Undated plans now expire out of Upcoming
 * after a grace window instead, so that expectation is inverted below rather
 * than preserved.
 *
 * The other half is `end_at`. The old two-argument helper could not see it, so
 * a plan running 7-11pm was called past at 7:01. Every dated plan in
 * production has a null end_at, which is also why the completion job -- which
 * filtered on end_at alone -- had never completed a single one.
 */
const DAY = 24 * 60 * 60 * 1000;
const iso = (ms: number) => new Date(ms).toISOString();

describe("plan lifecycle: dated plans", () => {
  it("is upcoming before it starts", () => {
    expect(planPhase({ status: "confirmed", startAt: iso(NOW + DAY) }, NOW)).toBe("upcoming");
    expect(isUpcomingPlan({ status: "confirmed", startAt: iso(NOW + DAY) }, NOW)).toBe(true);
  });

  it("is happening, not past, just after it starts with no end time", () => {
    // The production shape: every dated plan has a null end_at.
    //
    // This previously expected "past" immediately, on the reasoning that
    // inventing a duration is a guess. That made "is this plan on right now"
    // unanswerable -- and a plan that is on is exactly when its people need to
    // say they have arrived. It is now active for PLAN_DEFAULT_ACTIVE_MS.
    // The invariant that matters is unchanged and asserted below: it has not
    // finished, so it does not leave Home.
    const plan = { status: "confirmed" as const, startAt: iso(NOW - 1) };
    expect(planPhase(plan, NOW)).toBe("active");
    expect(isPastPlan(plan, NOW)).toBe(false);
    expect(isUpcomingPlan(plan, NOW)).toBe(true);
  });

  it("is past once the fallback window has elapsed, with no end time", () => {
    const plan = { status: "confirmed" as const, startAt: iso(NOW - PLAN_DEFAULT_ACTIVE_MS - 1) };
    expect(planPhase(plan, NOW)).toBe("past");
    expect(isPastPlan(plan, NOW)).toBe(true);
  });

  it("is still on mid-way through when it HAS an end time", () => {
    // A plan running 7-11pm is still on at 8. The old helper called it past
    // the moment it began, which took it off Home while people were at it.
    // THE INVARIANT, not the label: not past, and still on Home.
    const plan = { status: "confirmed" as const, startAt: iso(NOW - DAY), endAt: iso(NOW + DAY) };
    expect(planPhase(plan, NOW)).toBe("active");
    expect(isPastPlan(plan, NOW)).toBe(false);
    expect(isUpcomingPlan(plan, NOW)).toBe(true);
  });

  it("an explicit end time always beats the fallback", () => {
    // A long plan must not be cut short at three hours.
    const longPlan = { status: "confirmed" as const, startAt: iso(NOW - 5 * 60 * 60 * 1000), endAt: iso(NOW + DAY) };
    expect(planPhase(longPlan, NOW)).toBe("active");
    // ...and a deliberately short one must not be kept alive to three hours.
    const shortPlan = { status: "confirmed" as const, startAt: iso(NOW - 60 * 60 * 1000), endAt: iso(NOW - 1) };
    expect(planPhase(shortPlan, NOW)).toBe("past");
  });

  it("becomes near_start exactly 45 minutes before it begins", () => {
    const at = (offset: number) => planPhase({ status: "confirmed", startAt: iso(NOW + offset) }, NOW);
    expect(at(PLAN_NEAR_START_MS)).toBe("near_start");
    expect(at(PLAN_NEAR_START_MS + 1)).toBe("upcoming");
    expect(at(60_000)).toBe("near_start");
  });

  it("keeps a near-start or active plan on Home", () => {
    // Narrowing isUpcomingPlan to phase === "upcoming" would have made a plan
    // disappear 45 minutes before it started and stay gone while it was
    // happening -- the moments it matters most.
    expect(isUpcomingPlan({ status: "confirmed", startAt: iso(NOW + 60_000) }, NOW)).toBe(true);
    expect(isUpcomingPlan({ status: "confirmed", startAt: iso(NOW - 60_000) }, NOW)).toBe(true);
  });

  it("is past once the end time passes", () => {
    const plan = { status: "confirmed" as const, startAt: iso(NOW - 2 * DAY), endAt: iso(NOW - 1) };
    expect(planPhase(plan, NOW)).toBe("past");
  });

  it("treats a terminal status as past whatever the clock says", () => {
    for (const status of ["cancelled", "completed", "expired"] as const) {
      expect(planPhase({ status, startAt: iso(NOW + DAY) }, NOW), status).toBe("past");
    }
  });

  it("is exact at the boundary", () => {
    // At exactly the start the plan has begun -- which the old assertion
    // called "past" while its own comment said "has begun". Begun is now
    // active, and the comment and the expectation finally agree.
    expect(planPhase({ status: "confirmed", startAt: iso(NOW) }, NOW)).toBe("active");
    // One millisecond before the start it has not begun. It is inside the
    // 45-minute travel window, so near_start rather than upcoming.
    expect(planPhase({ status: "confirmed", startAt: iso(NOW + 1) }, NOW)).toBe("near_start");
    // Comfortably outside that window it is simply upcoming.
    expect(planPhase({ status: "confirmed", startAt: iso(NOW + PLAN_NEAR_START_MS + 1) }, NOW)).toBe("upcoming");
  });
});

describe("plan lifecycle: undated plans", () => {
  it("stays live inside the grace window", () => {
    const plan = { status: "inviting" as const, startAt: null, createdAt: iso(NOW - DAY) };
    expect(planPhase(plan, NOW)).toBe("unscheduled");
    expect(isUnscheduledPlan(plan, NOW)).toBe(true);
    // And is NOT upcoming: it never reaches Home.
    expect(isUpcomingPlan(plan, NOW)).toBe(false);
  });

  it("is set aside once the grace window closes", () => {
    // THE INVERTED EXPECTATION. This used to be asserted as `false` forever.
    const plan = {
      status: "inviting" as const,
      startAt: null,
      createdAt: iso(NOW - (UNSCHEDULED_PLAN_GRACE_DAYS + 1) * DAY)
    };
    expect(planPhase(plan, NOW)).toBe("archived_unscheduled");
    expect(isArchivedUnscheduledPlan(plan, NOW)).toBe(true);
    expect(isUpcomingPlan(plan, NOW)).toBe(false);
  });

  it("is exact at the grace boundary", () => {
    const at = { status: "inviting" as const, startAt: null, createdAt: iso(NOW - UNSCHEDULED_PLAN_GRACE_DAYS * DAY) };
    expect(planPhase(at, NOW)).toBe("archived_unscheduled");
    const justInside = {
      status: "inviting" as const,
      startAt: null,
      createdAt: iso(NOW - UNSCHEDULED_PLAN_GRACE_DAYS * DAY + 1)
    };
    expect(planPhase(justInside, NOW)).toBe("unscheduled");
  });

  it("keeps a plan visible when there is no creation date to measure from", () => {
    // Fails open: never archive something on the strength of a missing field.
    expect(planPhase({ status: "inviting", startAt: null, createdAt: null }, NOW)).toBe("unscheduled");
  });

  it("is never archived by the grace window once it has a date", () => {
    // Adding a time brings a plan straight back, however old it is.
    const plan = {
      status: "inviting" as const,
      startAt: iso(NOW + DAY),
      createdAt: iso(NOW - 400 * DAY)
    };
    expect(planPhase(plan, NOW)).toBe("upcoming");
  });

  it("reports when an undated plan will be set aside", () => {
    const createdAt = iso(NOW);
    expect(unscheduledDeadlineMs({ status: "inviting", startAt: null, createdAt })).toBe(
      NOW + UNSCHEDULED_PLAN_GRACE_DAYS * DAY
    );
    // Not applicable to a dated plan, or a finished one.
    expect(unscheduledDeadlineMs({ status: "inviting", startAt: iso(NOW), createdAt })).toBeNull();
    expect(unscheduledDeadlineMs({ status: "cancelled", startAt: null, createdAt })).toBeNull();
  });

  it("keeps the grace period in exactly one place", () => {
    // Scattering the number is how two surfaces come to disagree about
    // whether the same plan is still live.
    expect(UNSCHEDULED_PLAN_GRACE_DAYS).toBe(14);
  });
});

describe("plan lifecycle: chronology beats RSVP", () => {
  it("cannot be influenced by a participant's answer", () => {
    // Structural, not incidental: planPhase takes no participant argument, so
    // there is no way for going/maybe/not_going/invited/host to reach it.
    const finished = { status: "confirmed" as const, startAt: iso(NOW - DAY) };
    expect(planPhase(finished, NOW)).toBe("past");
    // The same plan, whoever is looking and whatever they answered.
    expect(isUpcomingPlan(finished, NOW)).toBe(false);
  });
});

describe("plan lifecycle: timezone behaviour", () => {
  it("compares absolute instants, so every timezone agrees", () => {
    // The same moment written in three offsets must resolve identically.
    // Date.parse yields the same epoch ms for all three, which is precisely
    // why a UTC server job and a browser in Accra or Los Angeles cannot
    // disagree about whether a plan has ended.
    const sameMoment = [
      "2026-07-16T13:00:00.000Z",
      "2026-07-16T14:00:00.000+01:00",
      "2026-07-16T06:00:00.000-07:00"
    ];
    for (const startAt of sameMoment) {
      expect(planPhase({ status: "confirmed", startAt }, NOW), startAt).toBe("upcoming");
    }
  });

  it("does not use the local calendar day to decide", () => {
    // A plan at 00:30 UTC is upcoming at 23:00 UTC the day before, even
    // though it falls on "tomorrow" locally west of Greenwich. Phase is about
    // the instant; the day label is a separate display concern.
    const nowLate = Date.parse("2026-07-16T23:00:00.000Z");
    expect(planPhase({ status: "confirmed", startAt: "2026-07-17T00:30:00.000Z" }, nowLate)).toBe("upcoming");
  });

  it("ignores an unparseable timestamp rather than guessing", () => {
    // Garbage in start_at must not silently read as "epoch, therefore past".
    expect(planPhase({ status: "inviting", startAt: "not a date", createdAt: iso(NOW) }, NOW)).toBe(
      "unscheduled"
    );
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
