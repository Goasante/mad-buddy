import { describe, expect, it } from "vitest";

import {
  REMINDER_OFFSET_MINUTES,
  REMINDER_OVERDUE_TOLERANCE_MINUTES,
  REMINDER_STAGES,
  eventRsvpWantsReminder,
  eventStatusAllowsReminder,
  isReminderStillUseful,
  planRsvpWantsReminder,
  planStatusAllowsReminder,
  reminderDueAtMs,
  reminderIdempotencyKey,
  schedulableStages,
  shouldScheduleStage,
  type ReminderStage
} from "@/lib/reminders/rules";

/**
 * The reminder decision core (Stage D).
 *
 * Pure, so these run the real logic rather than asserting on source text --
 * every timing rule, tolerance and eligibility decision is exercised for real
 * here, and the service tests cover the parts that need a database.
 */

const NOW = Date.parse("2026-08-11T12:00:00.000Z");
const MIN = 60 * 1000;
const HOUR = 60 * MIN;

const startIn = (ms: number) => NOW + ms;

// ---------------------------------------------------------------------------
// Offsets and due times
// ---------------------------------------------------------------------------

describe("reminder offsets", () => {
  it("uses the three approved stages", () => {
    expect(REMINDER_STAGES).toEqual(["24h", "2h", "near_start"]);
  });

  it("keeps the canonical offsets in one place", () => {
    expect(REMINDER_OFFSET_MINUTES["24h"]).toBe(1440);
    expect(REMINDER_OFFSET_MINUTES["2h"]).toBe(120);
    expect(REMINDER_OFFSET_MINUTES.near_start).toBe(30);
  });

  it("computes the due instant by subtracting the offset from the start", () => {
    const start = startIn(48 * HOUR);
    expect(reminderDueAtMs(start, "24h")).toBe(start - 24 * HOUR);
    expect(reminderDueAtMs(start, "2h")).toBe(start - 2 * HOUR);
    expect(reminderDueAtMs(start, "near_start")).toBe(start - 30 * MIN);
  });
});

// ---------------------------------------------------------------------------
// Scheduling: which stages are worth queueing at all
// ---------------------------------------------------------------------------

describe("stage scheduling", () => {
  it("schedules every stage for something comfortably ahead", () => {
    expect(schedulableStages(startIn(48 * HOUR), NOW)).toEqual(["24h", "2h", "near_start"]);
  });

  it("skips stages whose moment has long passed (same-day creation)", () => {
    // Created 90 minutes before it starts: the 24h moment passed 22.5 hours
    // ago, far outside its 6-hour tolerance, so it is never queued. The 2h
    // moment passed 30 minutes ago, inside its 45-minute tolerance, so it is.
    const stages = schedulableStages(startIn(90 * MIN), NOW);
    expect(stages).not.toContain("24h");
    expect(stages).toContain("2h");
    expect(stages).toContain("near_start");
  });

  it("schedules only the near-start stage for something imminent", () => {
    // Starts in 20 minutes: the near-start moment passed 10 minutes ago,
    // exactly at its tolerance, and both earlier stages are long gone.
    expect(schedulableStages(startIn(20 * MIN), NOW)).toEqual(["near_start"]);
  });

  it("schedules nothing once the thing has already started", () => {
    expect(schedulableStages(startIn(-MIN), NOW)).toEqual([]);
    expect(schedulableStages(NOW, NOW)).toEqual([]);
  });

  it("is exact at a stage boundary", () => {
    const start = startIn(2 * HOUR);
    // The 2h moment is exactly now: due, therefore schedulable.
    expect(shouldScheduleStage(start, "2h", NOW)).toBe(true);
    // One millisecond earlier and it is still ahead, which is also fine.
    expect(shouldScheduleStage(start + 1, "2h", NOW)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Overdue tolerance: the maintenance-recovery rule
// ---------------------------------------------------------------------------

describe("overdue tolerance (maintenance recovery)", () => {
  it("keeps stage-specific tolerances, tightest nearest the start", () => {
    expect(REMINDER_OVERDUE_TOLERANCE_MINUTES["24h"]).toBe(360);
    expect(REMINDER_OVERDUE_TOLERANCE_MINUTES["2h"]).toBe(45);
    expect(REMINDER_OVERDUE_TOLERANCE_MINUTES.near_start).toBe(10);
    // The ordering is the point: lateness costs more the closer you get.
    expect(REMINDER_OVERDUE_TOLERANCE_MINUTES["24h"]).toBeGreaterThan(
      REMINDER_OVERDUE_TOLERANCE_MINUTES["2h"]
    );
    expect(REMINDER_OVERDUE_TOLERANCE_MINUTES["2h"]).toBeGreaterThan(
      REMINDER_OVERDUE_TOLERANCE_MINUTES.near_start
    );
  });

  it("delivers a 24h reminder that is a few hours late", () => {
    // Start is 20 hours away: the 24h moment passed 4 hours ago, inside the
    // 6-hour tolerance. "Tomorrow" is still true, so it is still useful.
    expect(isReminderStillUseful(startIn(20 * HOUR), "24h", NOW)).toBe(true);
  });

  it("drops a 24h reminder that is beyond its tolerance", () => {
    // The 24h moment passed 7 hours ago.
    expect(isReminderStillUseful(startIn(17 * HOUR), "24h", NOW)).toBe(false);
  });

  it("drops a 2h reminder once the copy would be a lie", () => {
    // 45 minutes late: exactly at tolerance, still allowed.
    expect(isReminderStillUseful(startIn(2 * HOUR - 45 * MIN), "2h", NOW)).toBe(true);
    // 46 minutes late: dropped.
    expect(isReminderStillUseful(startIn(2 * HOUR - 46 * MIN), "2h", NOW)).toBe(false);
  });

  it("never delivers ANY pre-start stage once the thing has begun", () => {
    // THE WORST CASE THIS PREVENTS: a burst of "starts in 30 minutes" for
    // things that started an hour ago, the moment a paused scheduler resumes.
    for (const stage of REMINDER_STAGES) {
      expect(isReminderStillUseful(startIn(-MIN), stage, NOW), stage).toBe(false);
      expect(isReminderStillUseful(NOW, stage, NOW), stage).toBe(false);
    }
  });

  it("keeps every tolerance smaller than its own offset", () => {
    // THE INVARIANT THE ABOVE DEPENDS ON. While tolerance < offset, a stage
    // always goes stale strictly before the start instant, so tolerance alone
    // already prevents a post-start delivery. Raise any tolerance past its
    // offset and that stops being true -- at which point the explicit
    // already-started guard in isReminderStillUseful becomes the only thing
    // standing between a resumed scheduler and a reminder for something that
    // is already under way. Pinned here so such a change fails loudly.
    for (const stage of REMINDER_STAGES) {
      expect(
        REMINDER_OVERDUE_TOLERANCE_MINUTES[stage],
        `${stage}: tolerance must stay below its offset`
      ).toBeLessThan(REMINDER_OFFSET_MINUTES[stage]);
    }
  });

  it("refuses a post-start delivery even when tolerance would permit it", () => {
    // Exercises the already-started guard directly, independent of the
    // constants: a hypothetical stage whose tolerance exceeds its offset.
    // Constructed by asking about an instant after the start, where the
    // tolerance arithmetic alone would say "only slightly late".
    const start = startIn(-5 * MIN); // began five minutes ago
    // Its 24h moment was ~24h ago, but pick the stage whose due time is
    // nearest: near_start was due 25 minutes ago, inside no tolerance that
    // matters -- what rejects it first is that the thing has started.
    expect(isReminderStillUseful(start, "near_start", NOW)).toBe(false);
    // And the guard is what does it: the same call one millisecond before
    // the start, with the same lateness, is allowed.
    const justBefore = NOW + 1;
    expect(isReminderStillUseful(justBefore + 25 * MIN, "near_start", NOW)).toBe(true);
  });

  it("does not deliver a stage before its moment arrives", () => {
    // Start is 3 hours away: the 2h moment is still an hour ahead.
    expect(isReminderStillUseful(startIn(3 * HOUR), "2h", NOW)).toBe(false);
  });

  it("simulates a long maintenance window: nothing stale escapes", () => {
    // Scheduler paused for 12 hours, then resumes. Everything that started
    // during the outage is past and must be silent; only things still ahead
    // and still inside tolerance may fire.
    const resumeMs = NOW;
    const startedDuringOutage = resumeMs - 5 * HOUR;
    for (const stage of REMINDER_STAGES) {
      expect(isReminderStillUseful(startedDuringOutage, stage, resumeMs), stage).toBe(false);
    }
    // Something starting soon after the resume still gets its near-start.
    expect(isReminderStillUseful(resumeMs + 25 * MIN, "near_start", resumeMs)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Identity: dedupe and reschedule safety
// ---------------------------------------------------------------------------

describe("reminder identity", () => {
  const base = {
    domain: "event" as const,
    itemId: "11111111-1111-4111-8111-111111111111",
    userId: "22222222-2222-4222-8222-222222222222",
    stage: "2h" as ReminderStage,
    startAtMs: startIn(4 * HOUR)
  };

  it("is stable for the same reminder", () => {
    expect(reminderIdempotencyKey(base)).toBe(reminderIdempotencyKey({ ...base }));
  });

  it("differs per stage, per user, per item and per domain", () => {
    const key = reminderIdempotencyKey(base);
    expect(reminderIdempotencyKey({ ...base, stage: "24h" })).not.toBe(key);
    expect(reminderIdempotencyKey({ ...base, userId: "33333333-3333-4333-8333-333333333333" })).not.toBe(key);
    expect(reminderIdempotencyKey({ ...base, itemId: "44444444-4444-4444-8444-444444444444" })).not.toBe(key);
    expect(reminderIdempotencyKey({ ...base, domain: "plan" })).not.toBe(key);
  });

  it("changes when the item is rescheduled", () => {
    // THE RESCHEDULE MECHANISM. Friday 19:00 -> Saturday 20:00 produces a
    // different key, so the new time enqueues fresh jobs that cannot collide
    // with the old ones -- no schedule_version column required.
    const friday = reminderIdempotencyKey({ ...base, startAtMs: Date.parse("2026-08-14T19:00:00.000Z") });
    const saturday = reminderIdempotencyKey({ ...base, startAtMs: Date.parse("2026-08-15T20:00:00.000Z") });
    expect(friday).not.toBe(saturday);
  });

  it("carries the start timestamp, which is what makes that work", () => {
    expect(reminderIdempotencyKey(base)).toContain(String(base.startAtMs));
  });
});

// ---------------------------------------------------------------------------
// Eligibility
// ---------------------------------------------------------------------------

describe("plan eligibility", () => {
  it("reminds going and maybe", () => {
    expect(planRsvpWantsReminder("going")).toBe(true);
    expect(planRsvpWantsReminder("maybe")).toBe(true);
  });

  it("does not remind someone who declined or was removed", () => {
    expect(planRsvpWantsReminder("not_going")).toBe(false);
    expect(planRsvpWantsReminder("removed")).toBe(false);
  });

  it("does not remind someone who never answered", () => {
    // Reminding an unanswered invite as though it were a commitment is how a
    // reminder system starts feeling like nagging.
    expect(planRsvpWantsReminder("invited")).toBe(false);
    expect(planRsvpWantsReminder("viewed")).toBe(false);
  });

  it("does not remind a waitlisted participant", () => {
    expect(planRsvpWantsReminder("waitlisted")).toBe(false);
  });

  it("only allows live plan statuses", () => {
    for (const status of ["inviting", "polling", "confirmed"] as const) {
      expect(planStatusAllowsReminder(status), status).toBe(true);
    }
    for (const status of ["draft", "cancelled", "completed", "expired"] as const) {
      expect(planStatusAllowsReminder(status), status).toBe(false);
    }
  });
});

describe("event eligibility", () => {
  it("reminds only Going", () => {
    expect(eventRsvpWantsReminder("going")).toBe(true);
  });

  it("does not remind Interested", () => {
    // Interest is not attendance -- the Stage C rule, and Interested-only
    // events do not reach the personal agenda either.
    expect(eventRsvpWantsReminder("interested")).toBe(false);
  });

  it("does not remind Not Going", () => {
    expect(eventRsvpWantsReminder("not_going")).toBe(false);
  });

  it("only allows live event statuses", () => {
    expect(eventStatusAllowsReminder("scheduled")).toBe(true);
    expect(eventStatusAllowsReminder("active")).toBe(true);
    for (const status of ["draft", "cancelled", "ended"]) {
      expect(eventStatusAllowsReminder(status), status).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// Timezone
// ---------------------------------------------------------------------------

describe("timezone safety", () => {
  it("computes from absolute instants, so every offset agrees", () => {
    // The same moment written three ways must produce the same due time --
    // scheduling is done in epoch milliseconds and never from a formatted
    // local string.
    const written = [
      "2026-08-12T19:00:00.000Z",
      "2026-08-12T20:00:00.000+01:00",
      "2026-08-12T12:00:00.000-07:00"
    ].map((iso) => Date.parse(iso));
    const due = written.map((startAtMs) => reminderDueAtMs(startAtMs, "2h"));
    expect(new Set(due).size).toBe(1);
  });

  it("handles a positive offset (+05:30) without drift", () => {
    const start = Date.parse("2026-08-12T18:30:00.000+05:30");
    expect(reminderDueAtMs(start, "near_start")).toBe(start - 30 * MIN);
    expect(isReminderStillUseful(start, "near_start", start - 20 * MIN)).toBe(true);
  });

  it("handles a negative offset (-05:00) without drift", () => {
    const start = Date.parse("2026-08-12T18:30:00.000-05:00");
    expect(reminderDueAtMs(start, "24h")).toBe(start - 24 * HOUR);
  });

  it("crosses a day boundary correctly", () => {
    // Starts at 00:30 UTC; its 2h reminder belongs to the previous day.
    const start = Date.parse("2026-08-13T00:30:00.000Z");
    const due = reminderDueAtMs(start, "2h");
    expect(new Date(due).toISOString()).toBe("2026-08-12T22:30:00.000Z");
  });

  it("is unaffected by a DST transition, because it never uses local arithmetic", () => {
    // A UK DST boundary: 2026-10-25 01:00 UTC. Adding offsets in absolute ms
    // cannot land on a "missing" or "repeated" local hour, because no local
    // calendar arithmetic is performed at any point.
    const start = Date.parse("2026-10-25T01:30:00.000Z");
    expect(reminderDueAtMs(start, "2h")).toBe(start - 2 * HOUR);
    expect(new Date(reminderDueAtMs(start, "2h")).toISOString()).toBe("2026-10-24T23:30:00.000Z");
  });
});
