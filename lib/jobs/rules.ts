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
  | "media.strip_exif"
  | "media.delete_queued"
  | "billing.apply_scheduled_downgrade"
  | "recap.generate_monthly"
  | "streaks.close_expired_periods"
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
  | "notifications.send";

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
  { jobType: "media.delete_queued", everyMinutes: 60, priority: 4 },
  { jobType: "billing.apply_scheduled_downgrade", everyMinutes: 60, priority: 3 },
  { jobType: "streaks.close_expired_periods", everyMinutes: 60 * 24, priority: 6 },
  { jobType: "recap.generate_monthly", everyMinutes: 60 * 24, priority: 7 },
  { jobType: "expiry.plans", everyMinutes: 60, priority: 5 },
  { jobType: "expiry.statuses", everyMinutes: 15, priority: 5 },
  { jobType: "expiry.visibility_sessions", everyMinutes: 15, priority: 2 },
  { jobType: "expiry.pings", everyMinutes: 15, priority: 5 },
  { jobType: "expiry.moments", everyMinutes: 30, priority: 5 },
  { jobType: "expiry.drops", everyMinutes: 30, priority: 5 },
  { jobType: "expiry.invites", everyMinutes: 60, priority: 6 },
  { jobType: "expiry.friend_requests", everyMinutes: 60 * 12, priority: 6 },
  { jobType: "expiry.event_circles", everyMinutes: 60, priority: 6 },
  { jobType: "expiry.admin_assignments", everyMinutes: 60, priority: 2 }
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
