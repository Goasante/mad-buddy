import { describe, expect, it } from "vitest";
import {
  BASE_BACKOFF_MS,
  DEFAULT_MAX_ATTEMPTS,
  MAX_BACKOFF_MS,
  SCHEDULE,
  assessQueueHealth,
  backoffMs,
  canTransitionJob,
  isDueForSchedule,
  isPermanentError,
  isTerminalJobStatus,
  periodicIdempotencyKey,
  resolveFailure
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
  it("prioritises the Safe Arrival alert above everything — lateness there is a safety issue", () => {
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
      "recap.generate_monthly",
      "streaks.close_expired_periods"
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
