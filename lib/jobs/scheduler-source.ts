/**
 * Which scheduler triggered a cron tick.
 *
 * Two schedulers call /api/cron/tick: pg_cron inside Supabase (the primary,
 * on a real 5-minute cadence) and GitHub Actions (a lower-frequency backstop,
 * because GitHub throttles scheduled workflows heavily). Recording which one
 * fired makes a delayed or missing tick attributable — otherwise a silent
 * primary looks identical to a healthy one as long as the backstop covers.
 *
 * This is OBSERVABILITY ONLY. Job behaviour is identical regardless of source:
 * the same runner claims the same due jobs the same way. Nothing here gates,
 * authorises or branches the work.
 */

export const SCHEDULER_SOURCES = ["supabase_cron", "github_backstop", "manual"] as const;
export type SchedulerSource = (typeof SCHEDULER_SOURCES)[number];

/** Reported when a caller supplies something unrecognised. */
export const UNKNOWN_SCHEDULER_SOURCE = "unknown" as const;
export type ReportedSchedulerSource = SchedulerSource | typeof UNKNOWN_SCHEDULER_SOURCE;

/**
 * Normalise a caller-supplied source.
 *
 * An unrecognised value maps to "unknown" rather than being rejected: the tick
 * itself must still run, because refusing to process due jobs over a bad
 * label would turn a cosmetic problem into a missed safety alert. The odd
 * value is simply not trusted into the recognised set.
 *
 * Absent is also "unknown" — the value is never inferred from headers or IPs,
 * which would be a guess presented as fact.
 */
export function resolveSchedulerSource(raw: string | null | undefined): ReportedSchedulerSource {
  const value = (raw ?? "").trim().toLowerCase();
  if (!value) return UNKNOWN_SCHEDULER_SOURCE;
  return (SCHEDULER_SOURCES as readonly string[]).includes(value)
    ? (value as SchedulerSource)
    : UNKNOWN_SCHEDULER_SOURCE;
}

/**
 * A worker identifier that names the scheduler, for `jobs.locked_by`.
 *
 * Makes a stuck job attributable to the tick that claimed it. The random
 * suffix keeps two concurrent ticks from the same source distinguishable.
 */
export function workerIdFor(source: ReportedSchedulerSource, unique: string): string {
  return `${source}-${unique}`;
}

/**
 * What one tick did.
 *
 * Deliberately counts only. No job payloads, no user content, no identifiers
 * and no secrets — a tick summary is operational telemetry, and job payloads
 * can carry private data (a Safe Arrival session, a recipient list).
 */
export type TickSummary = {
  source: ReportedSchedulerSource;
  /** Correlates the log lines of one tick. Not a secret and not a user id. */
  tickId: string;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  jobsConsidered: number;
  jobsClaimed: number;
  jobsCompleted: number;
  jobsRetried: number;
  jobsFailed: number;
};

export function buildTickSummary(input: {
  source: ReportedSchedulerSource;
  tickId: string;
  startedAtMs: number;
  completedAtMs: number;
  considered: number;
  claimed: number;
  completed: number;
  retried: number;
  failed: number;
}): TickSummary {
  return {
    source: input.source,
    tickId: input.tickId,
    startedAt: new Date(input.startedAtMs).toISOString(),
    completedAt: new Date(input.completedAtMs).toISOString(),
    durationMs: Math.max(0, input.completedAtMs - input.startedAtMs),
    jobsConsidered: input.considered,
    jobsClaimed: input.claimed,
    jobsCompleted: input.completed,
    jobsRetried: input.retried,
    jobsFailed: input.failed
  };
}
