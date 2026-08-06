/**
 * Scheduler health.
 *
 * Pure: given the recent tick history, decides whether the scheduler is
 * healthy and whether an alert is due. No queries, no clock of its own.
 *
 * This exists because of a real incident: a migration redefined
 * private.run_cron_tick() and reverted an earlier pg_net schema fix, so every
 * tick failed. Nothing noticed. The failure was found by hand, minutes later,
 * and the job that stopped running was safe_arrival.unconfirmed_alert — the
 * one that tells someone's contacts they never confirmed arriving safely.
 *
 * Two independent failure modes, both covered here:
 *
 *  - FAILING: ticks are firing and erroring (the incident above).
 *  - MISSING: ticks are not firing at all — pg_cron unscheduled, the database
 *    paused, the extension dropped. A run history that simply stops looks
 *    healthy to anything that only inspects the newest row's status.
 */

/** One pg_cron run, as recorded in cron.job_run_details. */
export type TickRun = {
  startedAtMs: number;
  status: "succeeded" | "failed" | string;
};

export type SchedulerHealthState = "healthy" | "degraded" | "down";

export type SchedulerHealth = {
  state: SchedulerHealthState;
  /** How many failures since the last success. */
  consecutiveFailures: number;
  /** Null when no run in the window succeeded. */
  lastSuccessAtMs: number | null;
  /** Minutes since the last success, or null when never. */
  minutesSinceSuccess: number | null;
  /** True when ticks have stopped arriving entirely. */
  missing: boolean;
  /** Whether this state warrants paging someone. */
  shouldAlert: boolean;
  /** Short, safe summary. Never contains a secret or a job payload. */
  summary: string;
};

/**
 * Alert on the SECOND consecutive failure, not the first.
 *
 * One failed tick is usually a transient blip — a cold start, a dropped
 * connection — and the next tick five minutes later fixes it. Two in a row is
 * a pattern, and at a 5-minute cadence that is still only ~10 minutes of lost
 * work before anyone is told.
 */
export const CONSECUTIVE_FAILURE_ALERT_THRESHOLD = 2;

/**
 * How long without ANY tick before the scheduler is considered missing.
 *
 * Two and a bit intervals: long enough that one skipped slot is not an alarm,
 * short enough that a stopped scheduler is caught quickly.
 */
export const MISSING_TICK_ALERT_MS = 12 * 60 * 1000;

/**
 * Assess the scheduler from its recent runs.
 *
 * `runs` may arrive in any order; it is sorted here rather than trusted, so a
 * caller changing its query cannot silently invert the result.
 */
export function assessSchedulerHealth(runs: readonly TickRun[], nowMs = Date.now()): SchedulerHealth {
  const ordered = [...runs].sort((a, b) => b.startedAtMs - a.startedAtMs);

  const lastSuccess = ordered.find((run) => run.status === "succeeded") ?? null;
  const lastSuccessAtMs = lastSuccess?.startedAtMs ?? null;
  const minutesSinceSuccess =
    lastSuccessAtMs === null ? null : Math.floor((nowMs - lastSuccessAtMs) / 60_000);

  // Count failures from the newest run backwards, stopping at the first
  // success — that is what "consecutive" means here.
  let consecutiveFailures = 0;
  for (const run of ordered) {
    if (run.status === "succeeded") break;
    consecutiveFailures += 1;
  }

  // No runs at all, or the newest is older than the missing threshold. A
  // history that simply stops must not read as healthy.
  const newestAtMs = ordered[0]?.startedAtMs ?? null;
  const missing = newestAtMs === null || nowMs - newestAtMs > MISSING_TICK_ALERT_MS;

  const state: SchedulerHealthState = missing
    ? "down"
    : consecutiveFailures >= CONSECUTIVE_FAILURE_ALERT_THRESHOLD
      ? "down"
      : consecutiveFailures > 0
        ? "degraded"
        : "healthy";

  const shouldAlert = state === "down";

  return {
    state,
    consecutiveFailures,
    lastSuccessAtMs,
    minutesSinceSuccess,
    missing,
    shouldAlert,
    summary: summarise({ state, consecutiveFailures, missing, minutesSinceSuccess })
  };
}

function summarise(input: {
  state: SchedulerHealthState;
  consecutiveFailures: number;
  missing: boolean;
  minutesSinceSuccess: number | null;
}): string {
  if (input.missing) {
    return input.minutesSinceSuccess === null
      ? "No scheduler ticks recorded."
      : `No scheduler tick for ${input.minutesSinceSuccess} minutes.`;
  }
  if (input.state === "healthy") return "Scheduler healthy.";
  const plural = input.consecutiveFailures === 1 ? "tick" : "ticks";
  return `${input.consecutiveFailures} consecutive failed ${plural}.`;
}

/**
 * Whether to actually send an alert, given what was last sent.
 *
 * Two rules:
 *  - Do not repeat an alert for an ongoing outage; one page per incident.
 *  - Recovery is automatic: once ticks succeed again the state returns to
 *    healthy and `alreadyAlerted` is cleared by the caller, so the NEXT
 *    outage alerts normally.
 */
export function shouldSendAlert(health: SchedulerHealth, alreadyAlerted: boolean): boolean {
  return health.shouldAlert && !alreadyAlerted;
}

/** Whether a previously-alerted incident has recovered. */
export function hasRecovered(health: SchedulerHealth, alreadyAlerted: boolean): boolean {
  return alreadyAlerted && health.state === "healthy";
}
