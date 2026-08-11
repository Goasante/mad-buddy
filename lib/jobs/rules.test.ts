import { describe, expect, it } from "vitest";
import {
  BASE_BACKOFF_MS,
  DEFAULT_MAX_ATTEMPTS,
  MAX_BACKOFF_MS,
  SCHEDULE,
  SCHEDULER_HEALTH_CHECK_INTERVAL_MINUTES,
  assessQueueHealth,
  backoffMs,
  canTransitionJob,
  isDueForSchedule,
  isPermanentError,
  isSchedulerHealthCheckDue,
  isScheduleDue,
  isTerminalJobStatus,
  periodicIdempotencyKey,
  resolveFailure,
  type ScheduleSpec
} from "@/lib/jobs/rules";

const NOW = Date.parse("2026-07-17T12:00:00.000Z");
const MIN = 60 * 1000;

describe("backoff (spec §29)", () => {
  it("grows exponentially and caps", () => {
    expect(backoffMs(1)).toBe(BASE_BACKOFF_MS);
    expect(backoffMs(2)).toBe(BASE_BACKOFF_MS * 2);
    expect(backoffMs(3)).toBe(BASE_BACKOFF_MS * 4);
    expect(backoffMs(99)).toBe(MAX_BACKOFF_MS);
  });
});

describe("error classification (spec §29)", () => {
  it("treats provider/network problems as retryable", () => {
    for (const code of ["PROVIDER_UNAVAILABLE", "NETWORK_TIMEOUT", "RATE_LIMITED", "DATABASE_TIMEOUT"]) {
      expect(isPermanentError(code), code).toBe(false);
    }
  });

  it("never retries what can't succeed", () => {
    for (const code of ["INVALID_PUSH_TOKEN", "USER_DELETED", "RESOURCE_NOT_FOUND", "INVALID_WEBHOOK_SIGNATURE"]) {
      expect(isPermanentError(code), code).toBe(true);
    }
  });
});

describe("resolveFailure (spec §29, §30)", () => {
  it("schedules a retry for a transient error", () => {
    const outcome = resolveFailure({
      errorCode: "PROVIDER_UNAVAILABLE",
      attempts: 1,
      maxAttempts: DEFAULT_MAX_ATTEMPTS,
      nowMs: NOW
    });
    expect(outcome.status).toBe("retrying");
    expect(outcome.nextRunAtMs).toBe(NOW + BASE_BACKOFF_MS);
  });

  it("dead-letters a permanent error immediately, without burning attempts", () => {
    const outcome = resolveFailure({
      errorCode: "USER_DELETED",
      attempts: 1,
      maxAttempts: DEFAULT_MAX_ATTEMPTS,
      nowMs: NOW
    });
    expect(outcome).toEqual({ status: "dead_letter", nextRunAtMs: null, reason: "permanent" });
  });

  it("dead-letters once attempts are exhausted", () => {
    const outcome = resolveFailure({
      errorCode: "NETWORK_TIMEOUT",
      attempts: 5,
      maxAttempts: 5,
      nowMs: NOW
    });
    expect(outcome).toMatchObject({ status: "dead_letter", reason: "attempts_exhausted" });
  });
});

describe("job state machine (spec §28)", () => {
  it("follows the expected lifecycle", () => {
    expect(canTransitionJob("queued", "processing")).toBe(true);
    expect(canTransitionJob("processing", "completed")).toBe(true);
    expect(canTransitionJob("processing", "retrying")).toBe(true);
    expect(canTransitionJob("retrying", "processing")).toBe(true);
  });

  it("treats completed as final and dead_letter as replayable only by an operator", () => {
    expect(canTransitionJob("completed", "processing")).toBe(false);
    expect(isTerminalJobStatus("completed")).toBe(true);
    expect(isTerminalJobStatus("dead_letter")).toBe(true);
    // Explicit operator replay (spec §30).
    expect(canTransitionJob("dead_letter", "queued")).toBe(true);
  });
});

describe("schedule (spec §31)", () => {
  it("prioritises the Safe Arrival alert above everything, lateness there is a safety issue", () => {
    const safeArrival = SCHEDULE.find((spec) => spec.jobType === "safe_arrival.unconfirmed_alert");
    expect(safeArrival).toBeDefined();
    expect(safeArrival!.priority).toBe(1);
    for (const spec of SCHEDULE) {
      expect(safeArrival!.priority).toBeLessThanOrEqual(spec.priority);
    }
    // Frequent enough to be useful against a 5+ minute grace period.
    expect(safeArrival!.everyMinutes).toBeLessThanOrEqual(5);
  });

  it("covers every job that batches 5-13 left un-run", () => {
    const types = SCHEDULE.map((spec) => spec.jobType);
    for (const jobType of [
      "safe_arrival.unconfirmed_alert",
      "media.delete_queued",
      "billing.apply_scheduled_downgrade",
      "financial.capture_daily_snapshot",
      "financial.reconcile_paystack_fees",
      "trials.lifecycle",
      "recap.generate_monthly",
      "streaks.close_expired_periods"
      ,"birthdays.notify"
    ]) {
      expect(types, jobType).toContain(jobType);
    }
  });

  it("collapses a double-tick to one job via a period bucket", () => {
    const key = periodicIdempotencyKey("expiry.statuses", 15, NOW);
    // Same 15-minute bucket → same key → unique index rejects the duplicate.
    expect(periodicIdempotencyKey("expiry.statuses", 15, NOW + 60_000)).toBe(key);
    // Next bucket → new key.
    expect(periodicIdempotencyKey("expiry.statuses", 15, NOW + 16 * MIN)).not.toBe(key);
  });

  it("is due when never run, and after its interval", () => {
    const spec = SCHEDULE[0];
    expect(isDueForSchedule(spec, null, NOW)).toBe(true);
    expect(isDueForSchedule(spec, NOW - MIN, NOW)).toBe(false);
    expect(isDueForSchedule(spec, NOW - 10 * MIN, NOW)).toBe(true);
  });
});

/**
 * isScheduleDue: the stateless due check.
 *
 * WHAT THIS REPLACES. enqueueDueSchedules used to attempt an insert for every
 * one of the twenty entries in SCHEDULE on every 5-minute tick, and rely on
 * periodicIdempotencyKey's unique index to reject the ~17 not actually due.
 * That was correct but wasteful: a 60-minute job attempted eleven
 * guaranteed-to-fail inserts between the one that succeeded, a daily job 287.
 * isScheduleDue lets the worker skip the insert entirely for those, using only
 * nowMs -- no stored "last run" state, so it can never disagree with the
 * bucket periodicIdempotencyKey itself computes.
 */
describe("isScheduleDue (Vercel usage optimization, cron pass)", () => {
  const spec = (everyMinutes: number): ScheduleSpec => ({
    jobType: "expiry.statuses",
    everyMinutes,
    priority: 5
  });

  it("is due on the tick that starts its bucket", () => {
    // NOW is exactly midday UTC, which aligns to every period up to twelve
    // hours (a whole number of periods since epoch) but not to a day, which
    // resets at midnight UTC rather than at NOW's own offset. Each cadence is
    // therefore checked at ITS OWN nearest bucket start on or after NOW.
    for (const everyMinutes of [5, 15, 30, 60, 60 * 12]) {
      expect(isScheduleDue(spec(everyMinutes), NOW), `every ${everyMinutes}min`).toBe(true);
    }
    const midnightUtc = Date.parse("2026-07-18T00:00:00.000Z");
    expect(isScheduleDue(spec(60 * 24), midnightUtc)).toBe(true);
  });

  it("stays due for the first 5-minute tick width of a longer bucket", () => {
    // An hourly job's bucket spans twelve 5-minute ticks; only the first of
    // them should insert. A tick landing 1 minute into the bucket is still
    // that first tick -- the insert has not happened yet.
    expect(isScheduleDue(spec(60), NOW + 1 * MIN)).toBe(true);
    expect(isScheduleDue(spec(60), NOW + 4 * MIN)).toBe(true);
  });

  it("is not due for the remaining ticks in the bucket", () => {
    // The 2nd through 12th five-minute ticks of an hourly bucket must not
    // reattempt the insert the 1st tick already made.
    expect(isScheduleDue(spec(60), NOW + 5 * MIN)).toBe(false);
    expect(isScheduleDue(spec(60), NOW + 30 * MIN)).toBe(false);
    expect(isScheduleDue(spec(60), NOW + 55 * MIN)).toBe(false);
  });

  it("is due again exactly at the next boundary", () => {
    expect(isScheduleDue(spec(60), NOW + 60 * MIN)).toBe(true);
  });

  it("is exact one millisecond either side of the boundary", () => {
    expect(isScheduleDue(spec(60), NOW + 60 * MIN - 1)).toBe(false);
    expect(isScheduleDue(spec(60), NOW + 60 * MIN)).toBe(true);
  });

  it("never skips the 5-minute Safe Arrival job", () => {
    // At everyMinutes = 5, the bucket IS one tick wide: every tick is that
    // bucket's first (and only) tick, so this must be due on every tick this
    // spec is ever checked against. Lateness here is a safety consequence,
    // not a cosmetic one, and this optimization must not touch it.
    const safeArrival = SCHEDULE.find((entry) => entry.jobType === "safe_arrival.unconfirmed_alert")!;
    for (let offset = 0; offset < 60; offset += 5) {
      expect(isScheduleDue(safeArrival, NOW + offset * MIN), `+${offset}min`).toBe(true);
    }
  });

  it("handles a daily schedule's full 288-tick bucket", () => {
    // Anchored on an actual midnight-UTC boundary, since a day resets there
    // rather than at NOW's own offset.
    const daily = spec(60 * 24);
    const midnightUtc = Date.parse("2026-07-18T00:00:00.000Z");
    expect(isScheduleDue(daily, midnightUtc)).toBe(true);
    expect(isScheduleDue(daily, midnightUtc + 5 * MIN)).toBe(false);
    expect(isScheduleDue(daily, midnightUtc + 12 * 60 * MIN)).toBe(false);
    expect(isScheduleDue(daily, midnightUtc + 23 * 60 * MIN + 55 * MIN)).toBe(false);
    expect(isScheduleDue(daily, midnightUtc + 24 * 60 * MIN)).toBe(true);
  });

  it("handles the twelve-hour schedule (expiry.friend_requests)", () => {
    const halfDay = SCHEDULE.find((entry) => entry.jobType === "expiry.friend_requests")!;
    expect(halfDay.everyMinutes).toBe(60 * 12);
    expect(isScheduleDue(halfDay, NOW)).toBe(true);
    expect(isScheduleDue(halfDay, NOW + 6 * 60 * MIN)).toBe(false);
    expect(isScheduleDue(halfDay, NOW + 12 * 60 * MIN)).toBe(true);
  });

  it("agrees with periodicIdempotencyKey about where bucket boundaries fall", () => {
    // The two must never disagree about which bucket nowMs belongs to, or a
    // "due" tick could compute a key for the wrong bucket.
    for (const [everyMinutes, bucketStart] of [
      [15, NOW],
      [60, NOW],
      [60 * 24, Date.parse("2026-07-18T00:00:00.000Z")]
    ] as const) {
      const s = spec(everyMinutes);
      const keyAtStart = periodicIdempotencyKey(s.jobType, everyMinutes, bucketStart);
      const keyMidBucket = periodicIdempotencyKey(s.jobType, everyMinutes, bucketStart + 2 * MIN);
      expect(keyAtStart, `${everyMinutes}min`).toBe(keyMidBucket);
      expect(isScheduleDue(s, bucketStart)).toBe(true);
    }
  });

  it("reduces a typical 5-minute tick to a fraction of the twenty entries", () => {
    // THE MEASURED CLAIM. At an arbitrary non-boundary tick, only the
    // schedules whose bucket started on THIS tick should be due -- proving
    // the old "attempt all twenty" behaviour is gone, without hardcoding an
    // exact count that would break the moment SCHEDULE gains an entry.
    const dueCount = SCHEDULE.filter((s) => isScheduleDue(s, NOW + 35 * MIN)).length;
    expect(dueCount).toBeLessThan(SCHEDULE.length);
    expect(dueCount).toBeGreaterThan(0);
  });
});

/**
 * isSchedulerHealthCheckDue: throttling the health check independent of the
 * work it monitors.
 *
 * WHY THIS IS SAFE TO THROTTLE AT ALL. The health check can only ever run
 * from inside a tick that is actually executing. A scheduler that has
 * genuinely stopped produces zero ticks and therefore zero calls to this
 * function -- there is no "skipped" check to worry about on the failure path,
 * only fewer redundant re-confirmations on the healthy path. See the constant
 * for why 15 minutes specifically.
 */
describe("isSchedulerHealthCheckDue (Vercel usage optimization, cron pass)", () => {
  it("is due on the tick that starts its own bucket", () => {
    expect(isSchedulerHealthCheckDue(NOW)).toBe(true);
  });

  it("is not due for the tick in between", () => {
    // At a 10-minute interval and a 5-minute tick width, each bucket spans
    // exactly two ticks: the one at offset 0 (due) and the one at offset 5
    // (not). +10min is already the START of the next bucket, not "in between".
    expect(isSchedulerHealthCheckDue(NOW + 5 * MIN)).toBe(false);
  });

  it("is due again at the next boundary", () => {
    expect(isSchedulerHealthCheckDue(NOW + SCHEDULER_HEALTH_CHECK_INTERVAL_MINUTES * MIN)).toBe(true);
  });

  it("stays comfortably inside the missing-tick alarm window", () => {
    // MISSING_TICK_ALERT_MS in scheduler-health.ts is 12 minutes. This check's
    // own cadence must stay below that, or a throttled check could routinely
    // run less often than the condition it exists to catch.
    expect(SCHEDULER_HEALTH_CHECK_INTERVAL_MINUTES).toBeLessThan(12);
  });

  it("still checks during a genuinely idle period, eventually", () => {
    // Not "only when work happened" -- ticks with nothing enqueued or claimed
    // must still eventually run the check, on their own independent cadence.
    let sawDue = false;
    for (let offset = 0; offset < 60; offset += 5) {
      if (isSchedulerHealthCheckDue(NOW + offset * MIN)) sawDue = true;
    }
    expect(sawDue).toBe(true);
  });
});

describe("queue health (spec §52, §54)", () => {
  it("is healthy when quiet", () => {
    expect(assessQueueHealth({ backlog: 10, deadLetter: 0, oldestAgeMs: 1000 })).toMatchObject({
      healthy: true,
      reasons: []
    });
  });

  it("alerts on a growing backlog, a stale oldest job, or rising dead letters", () => {
    expect(assessQueueHealth({ backlog: 1000, deadLetter: 0, oldestAgeMs: 0 }).reasons).toContain("backlog_growing");
    expect(assessQueueHealth({ backlog: 0, deadLetter: 0, oldestAgeMs: 60 * MIN }).reasons).toContain(
      "oldest_job_stale"
    );
    expect(assessQueueHealth({ backlog: 0, deadLetter: 100, oldestAgeMs: 0 }).reasons).toContain("dead_letter_rising");
  });
});
