/**
 * Job queue core (feature architecture batch 14, spec §26-§32). Pure and
 * deterministic: state transitions, retry/backoff, and the distinction between
 * a failure worth retrying and one that never will be.
 *
 * That distinction is the point (spec §29): retrying a permanently invalid job
 * forever burns the queue and delays the work that matters. An invalid push
 * token or a deleted user is not a transient error and must not be treated as
 * one.
 */

export type JobStatus =
  | "queued"
  | "scheduled"
  | "processing"
  | "completed"
  | "failed"
  | "retrying"
  | "dead_letter";

export type JobType =
  // The six that batches 5-13 left un-run.
  | "safe_arrival.unconfirmed_alert"
  | "upfor.announce_started"
  | "media.strip_exif"
  | "media.cleanup_orphan_chat"
  | "media.delete_queued"
  | "billing.apply_scheduled_downgrade"
  | "financial.capture_daily_snapshot"
  | "financial.reconcile_paystack_fees"
  | "trials.lifecycle"
  /**
   * Welcome Access reminders (days 4 and 1 remaining).
   *
   * DAILY, not hourly. The milestones are whole days, so an hourly run would
   * re-evaluate the same population 24 times to send the same two
   * notifications -- the dedupe ledger would absorb it, but the work is
   * pointless. Reminders are also the ONLY thing this job does: expiry itself
   * is resolver-time, so no job has to flip anybody from active to expired.
   */
  | "access.welcome_reminders"
  | "recap.generate_monthly"
  | "streaks.close_expired_periods"
  | "birthdays.notify"
  | "rewards.earned_premium"
  | "plans.lifecycle_side_effect"
  // Plan Chat closure: read-only + archived once the Plan is well over.
  | "plans.close_chats"
  | "events.update_fanout"
  // Expiry sweeps (spec §31).
  | "expiry.plans"
  | "expiry.statuses"
  | "expiry.visibility_sessions"
  | "expiry.pings"
  | "expiry.moments"
  | "expiry.drops"
  | "expiry.invites"
  | "expiry.friend_requests"
  | "expiry.event_circles"
  | "expiry.admin_assignments"
  | "notifications.send"
  // Plan/Event reminders (Stage D). `scan` is periodic and enqueues `deliver`
  // jobs at their exact reminder instants; `deliver` is never on SCHEDULE
  // because it is created with a run_at rather than a cadence.
  | "reminders.scan"
  | "reminders.deliver";

// ---------------------------------------------------------------------------
// Retry policy (spec §29)
// ---------------------------------------------------------------------------

export const DEFAULT_MAX_ATTEMPTS = 5;
export const BASE_BACKOFF_MS = 30 * 1000;
export const MAX_BACKOFF_MS = 60 * 60 * 1000;

/**
 * Exponential backoff with a cap. Deterministic given `attempt`, jitter is
 * added by the caller if needed, so this stays testable.
 */
export function backoffMs(attempt: number): number {
  const exponent = Math.max(0, attempt - 1);
  return Math.min(BASE_BACKOFF_MS * 2 ** exponent, MAX_BACKOFF_MS);
}

/**
 * Errors that will never succeed on retry (spec §29). Classified by code, not
 * by message, so the decision is stable.
 */
export const PERMANENT_ERROR_CODES = [
  "INVALID_PUSH_TOKEN",
  "USER_DELETED",
  "RESOURCE_NOT_FOUND",
  "INVALID_WEBHOOK_SIGNATURE",
  "NOT_AUTHORISED",
  "VALIDATION_FAILED",
  "ALREADY_PROCESSED",
  "CONTEXT_INVALID"
] as const;

export type PermanentErrorCode = (typeof PERMANENT_ERROR_CODES)[number];

export const RETRYABLE_ERROR_CODES = [
  "PROVIDER_UNAVAILABLE",
  "NETWORK_TIMEOUT",
  "RATE_LIMITED",
  "DATABASE_TIMEOUT",
  "INTERNAL_ERROR"
] as const;

export function isPermanentError(code: string): boolean {
  return (PERMANENT_ERROR_CODES as readonly string[]).includes(code);
}

export type FailureOutcome = {
  status: Extract<JobStatus, "retrying" | "dead_letter" | "failed">;
  nextRunAtMs: number | null;
  reason: "permanent" | "attempts_exhausted" | "retry_scheduled";
};

/**
 * What to do with a failed job. A permanent error goes straight to the
 * dead-letter queue without burning the remaining attempts, retrying it four
 * more times helps nobody and delays real work.
 */
export function resolveFailure(input: {
  errorCode: string;
  attempts: number;
  maxAttempts: number;
  nowMs: number;
}): FailureOutcome {
  if (isPermanentError(input.errorCode)) {
    return { status: "dead_letter", nextRunAtMs: null, reason: "permanent" };
  }
  if (input.attempts >= input.maxAttempts) {
    return { status: "dead_letter", nextRunAtMs: null, reason: "attempts_exhausted" };
  }
  return {
    status: "retrying",
    nextRunAtMs: input.nowMs + backoffMs(input.attempts),
    reason: "retry_scheduled"
  };
}

// ---------------------------------------------------------------------------
// State machine (spec §28)
// ---------------------------------------------------------------------------

const JOB_TRANSITIONS: Record<JobStatus, JobStatus[]> = {
  queued: ["processing", "scheduled", "dead_letter"],
  scheduled: ["queued", "processing", "dead_letter"],
  processing: ["completed", "failed", "retrying", "dead_letter"],
  retrying: ["processing", "dead_letter"],
  failed: ["retrying", "dead_letter"],
  completed: [],
  dead_letter: ["queued"] // only via an explicit operator replay (spec §30)
};

export function canTransitionJob(from: JobStatus, to: JobStatus): boolean {
  return JOB_TRANSITIONS[from]?.includes(to) ?? false;
}

export function isTerminalJobStatus(status: JobStatus): boolean {
  return status === "completed" || status === "dead_letter";
}

// ---------------------------------------------------------------------------
// Scheduling (spec §31)
// ---------------------------------------------------------------------------

export type ScheduleSpec = {
  jobType: JobType;
  /** How often the tick should enqueue this, in minutes. */
  everyMinutes: number;
  priority: number;
};

/**
 * The recurring schedule. Priority 1 is the Safe Arrival alert deliberately:
 * it is the only job here where being late has a safety consequence rather
 * than a cosmetic one.
 */
export const SCHEDULE: readonly ScheduleSpec[] = [
  { jobType: "safe_arrival.unconfirmed_alert", everyMinutes: 5, priority: 1 },
  /* A scheduled UpFor announces itself when it starts, not when it was
     created. Five minutes matches the safe-arrival cadence: the alternative
     is a per-row timer for exact-second delivery, which is a lot of
     machinery for a "someone is free" notification. Being a few minutes late
     is fine; being four hours EARLY was the defect. */
  { jobType: "upfor.announce_started", everyMinutes: 5, priority: 3 },
  { jobType: "media.cleanup_orphan_chat", everyMinutes: 60, priority: 4 },
  { jobType: "media.delete_queued", everyMinutes: 60, priority: 4 },
  { jobType: "billing.apply_scheduled_downgrade", everyMinutes: 60, priority: 3 },
  { jobType: "financial.capture_daily_snapshot", everyMinutes: 60 * 24, priority: 6 },
  { jobType: "financial.reconcile_paystack_fees", everyMinutes: 60 * 24, priority: 6 },
  { jobType: "trials.lifecycle", everyMinutes: 60, priority: 3 },
  { jobType: "access.welcome_reminders", everyMinutes: 60 * 24, priority: 6 },
  { jobType: "streaks.close_expired_periods", everyMinutes: 60 * 24, priority: 6 },
  { jobType: "recap.generate_monthly", everyMinutes: 60 * 24, priority: 7 },
  { jobType: "birthdays.notify", everyMinutes: 60, priority: 5 },
  { jobType: "rewards.earned_premium", everyMinutes: 60 * 24, priority: 6 },
  { jobType: "expiry.plans", everyMinutes: 60, priority: 5 },
  /* Plan Chat closure. Hourly, alongside the plan completion sweep it depends
     on: a plan reaches `completed` there, and its chat closes here. Priority 6
     because nothing is unsafe about a chat closing an hour late -- unlike the
     safety alert at priority 1 -- and the batch is bounded so a backlog simply
     drains over the next few ticks. */
  { jobType: "plans.close_chats", everyMinutes: 60, priority: 6 },
  { jobType: "expiry.statuses", everyMinutes: 15, priority: 5 },
  { jobType: "expiry.visibility_sessions", everyMinutes: 15, priority: 2 },
  { jobType: "expiry.pings", everyMinutes: 15, priority: 5 },
  { jobType: "expiry.moments", everyMinutes: 30, priority: 5 },
  { jobType: "expiry.drops", everyMinutes: 30, priority: 5 },
  { jobType: "expiry.invites", everyMinutes: 60, priority: 6 },
  { jobType: "expiry.friend_requests", everyMinutes: 60 * 12, priority: 6 },
  { jobType: "expiry.event_circles", everyMinutes: 60, priority: 6 },
  { jobType: "expiry.admin_assignments", everyMinutes: 60, priority: 2 },
  /**
   * Reminder discovery (Stage D).
   *
   * Every 15 minutes, not every 5: the scan only needs to enqueue a delivery
   * job before its moment arrives, and the horizon (26 hours) is vastly
   * larger than the gap between scans, so nothing can be missed by scanning
   * less often. Delivery precision comes from each job's own run_at, never
   * from this cadence -- a 30-minute reminder fires at 30 minutes regardless
   * of when the scan that queued it ran.
   *
   * Priority 5 keeps it below the Safe Arrival alert, which is the one job
   * here where lateness is a safety consequence rather than a cosmetic one.
   */
  { jobType: "reminders.scan", everyMinutes: 15, priority: 5 }
];

/**
 * Bucket key for a periodic job, so one tick per period enqueues exactly one
 * job even if cron fires twice or overlaps. Combined with the unique
 * idempotency index, a double-tick is a no-op rather than a double-run.
 */
export function periodicIdempotencyKey(jobType: JobType, everyMinutes: number, nowMs: number): string {
  const bucket = Math.floor(nowMs / (everyMinutes * 60 * 1000));
  return `periodic:${jobType}:${bucket}`;
}

export function isDueForSchedule(spec: ScheduleSpec, lastRunAtMs: number | null, nowMs: number): boolean {
  if (lastRunAtMs === null) return true;
  return nowMs - lastRunAtMs >= spec.everyMinutes * 60 * 1000;
}

/**
 * How often the tick itself fires. `pg_cron` runs `cron-tick-5min` on a real
 * 5-minute schedule (20260723180000_pg_cron_tick.sql); GitHub Actions is the
 * same nominal cadence but throttled, so this is the tighter of the two and
 * the correct width to check a bucket boundary against.
 */
const TICK_INTERVAL_MINUTES = 5;

/**
 * Whether THIS TICK is the one that should enqueue `spec`, without reading any
 * stored state.
 *
 * THE PROBLEM THIS REPLACES. `enqueueDueSchedules` used to attempt an insert
 * for every one of the twenty schedules on every tick and let the database's
 * unique idempotency index reject the ones not yet due. That works -- nothing
 * was ever double-enqueued -- but it means an hourly job attempts eleven
 * guaranteed-to-fail inserts between the one that succeeds, and a daily job
 * attempts 287. Roughly eighteen of twenty-one round trips a typical tick
 * spent were exactly that: an insert whose only possible outcomes were
 * "succeed once a period" or "fail because it already did".
 *
 * WHY A BUCKET COMPARISON AND NOT A STORED "LAST RUN" TIMESTAMP. Reading
 * "when did this last enqueue" would trade twenty semi-wasted inserts for one
 * extra read per schedule, which is not obviously cheaper and reintroduces the
 * chicken-and-egg problem of a value only the enqueue itself would set. The
 * bucket a job belongs to is computable from nowMs alone -- the same
 * `Math.floor(nowMs / periodMs)` periodicIdempotencyKey already uses -- so
 * "is this tick the one that starts this schedule's bucket" needs no I/O.
 *
 * WHY "FIRST TICK OF THE BUCKET" RATHER THAN "BUCKET CHANGED SINCE LAST
 * CALL". This function is pure and stateless by design: it must give the same
 * answer for the same nowMs regardless of when it was last invoked, including
 * never. A bucket only spans multiple 5-minute ticks for periods above 5
 * minutes, and this is due on the FIRST of those ticks -- the one where
 * elapsed time within the bucket is less than one tick width. For
 * everyMinutes = 5, every tick's own bucket is naturally the first (and only)
 * tick in it, so nothing changes for the safety-critical Safe Arrival job.
 *
 * THE UNIQUE INDEX IS STILL THE GUARANTEE. If two schedulers overlap, or this
 * function is ever wrong at a boundary, the insert either lands once or is
 * rejected by `periodic:{jobType}:{bucket}` exactly as before -- this is
 * purely a cost reduction on the common, nothing-to-do path, never a
 * correctness mechanism in its own right.
 */
export function isScheduleDue(spec: ScheduleSpec, nowMs: number): boolean {
  const periodMs = spec.everyMinutes * 60 * 1000;
  const elapsedInBucket = nowMs % periodMs;
  return elapsedInBucket < TICK_INTERVAL_MINUTES * 60 * 1000;
}

/**
 * How often `checkSchedulerHealthAndAlert` actually reads the database,
 * independent of the 5-minute tick that calls it.
 *
 * CANNOT BE THROTTLED THE SAME WAY A REGULAR SCHEDULE IS. A schedule that
 * misses a tick just runs a little late; the health check exists to notice
 * when ticks stop happening AT ALL, and it only ever runs from inside a tick
 * that IS happening. Throttling how often it queries therefore only ever
 * costs alert LATENCY, never detection: `assessSchedulerHealth` reads a
 * 12-run window from `cron.job_run_details` every time it does query, so
 * whenever this next runs it still sees the full gap and still alerts. A
 * scheduler that is actually down produces zero ticks and therefore zero
 * calls to this function regardless of the interval chosen here -- throttling
 * only reduces how often a HEALTHY run re-confirms that it is healthy.
 *
 * TEN MINUTES, not the 30-60 suggested for an unconstrained health check:
 * MISSING_TICK_ALERT_MS (scheduler-health.ts) is 12 minutes, and this interval
 * is kept BELOW it -- two ticks of headroom -- so a check that lands right at
 * the start of its throttle window, immediately followed by the scheduler
 * dying, still has its next scheduled check fire before 12 minutes of silence
 * would itself have qualified as "missing" on a from-scratch read. Total
 * worst-case detection-to-alert latency stays under 22 minutes, comfortably
 * inside how the real incident that motivated this file was actually found
 * (by hand, "minutes later") -- and unlike that discovery, this one no longer
 * depends on a person noticing.
 */
export const SCHEDULER_HEALTH_CHECK_INTERVAL_MINUTES = 10;

/**
 * Whether THIS TICK should perform the health check's DB reads.
 *
 * Same bucket-boundary shape as isScheduleDue, and deliberately not sharing
 * its implementation: the two throttle unrelated things for unrelated
 * reasons, and a future change to one must not silently retune the other.
 */
export function isSchedulerHealthCheckDue(nowMs: number): boolean {
  const periodMs = SCHEDULER_HEALTH_CHECK_INTERVAL_MINUTES * 60 * 1000;
  const elapsedInBucket = nowMs % periodMs;
  return elapsedInBucket < TICK_INTERVAL_MINUTES * 60 * 1000;
}

// ---------------------------------------------------------------------------
// Worker guards
// ---------------------------------------------------------------------------

/** A job stuck in `processing` past this is assumed orphaned and reclaimed. */
export const STALE_LOCK_SECONDS = 300;

/** Bounded work per tick, so one invocation can't run past its time limit. */
export const MAX_JOBS_PER_TICK = 25;

/**
 * Health signal for the queue (spec §52): a growing backlog or a rising
 * dead-letter count is the alertable condition, not raw throughput.
 */
export type QueueHealth = {
  healthy: boolean;
  backlog: number;
  deadLetter: number;
  oldestAgeMs: number;
  reasons: string[];
};

export const BACKLOG_ALERT_THRESHOLD = 500;
export const OLDEST_JOB_ALERT_MS = 30 * 60 * 1000;
export const DEAD_LETTER_ALERT_THRESHOLD = 25;

export function assessQueueHealth(input: {
  backlog: number;
  deadLetter: number;
  oldestAgeMs: number;
}): QueueHealth {
  const reasons: string[] = [];
  if (input.backlog > BACKLOG_ALERT_THRESHOLD) reasons.push("backlog_growing");
  if (input.oldestAgeMs > OLDEST_JOB_ALERT_MS) reasons.push("oldest_job_stale");
  if (input.deadLetter > DEAD_LETTER_ALERT_THRESHOLD) reasons.push("dead_letter_rising");
  return {
    healthy: reasons.length === 0,
    backlog: input.backlog,
    deadLetter: input.deadLetter,
    oldestAgeMs: input.oldestAgeMs,
    reasons
  };
}
