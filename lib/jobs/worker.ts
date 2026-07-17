import "server-only";

import { JOB_HANDLERS, JobError } from "@/lib/jobs/handlers";
import {
  MAX_JOBS_PER_TICK,
  SCHEDULE,
  STALE_LOCK_SECONDS,
  assessQueueHealth,
  periodicIdempotencyKey,
  resolveFailure,
  type JobType
} from "@/lib/jobs/rules";
import { errorType, logBackendEvent } from "@/lib/observability/logger";
import type { createSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * Job worker (feature architecture batch 14, spec §26-§31).
 *
 * Invoked by the cron tick. Two properties matter most:
 *  - Claiming is atomic (`claim_jobs` uses FOR UPDATE SKIP LOCKED), so two
 *    overlapping ticks can never run the same job — which is what stops a
 *    double-sent Safe Arrival alert.
 *  - A handler failure is classified, not blindly retried (spec §29).
 */

type Admin = ReturnType<typeof createSupabaseAdminClient>;

export type TickResult = {
  enqueued: number;
  processed: number;
  succeeded: number;
  failed: number;
  deadLettered: number;
};

/**
 * Enqueues due periodic jobs. The period-bucket idempotency key plus the
 * unique index means an overlapping or double-firing cron enqueues nothing
 * extra rather than duplicating work.
 */
export async function enqueueDueSchedules(admin: Admin, nowMs = Date.now()): Promise<number> {
  let enqueued = 0;
  for (const spec of SCHEDULE) {
    const key = periodicIdempotencyKey(spec.jobType, spec.everyMinutes, nowMs);
    const { error } = await admin.from("jobs").insert({
      job_type: spec.jobType,
      payload: {},
      priority: spec.priority,
      status: "queued",
      idempotency_key: key,
      run_at: new Date(nowMs).toISOString()
    });
    // A unique violation means this period is already enqueued — expected.
    if (!error) enqueued += 1;
  }
  return enqueued;
}

async function completeJob(admin: Admin, jobId: string) {
  await admin
    .from("jobs")
    .update({ status: "completed", completed_at: new Date().toISOString(), locked_at: null, locked_by: null })
    .eq("id", jobId);
}

async function failJob(
  admin: Admin,
  job: { id: string; attempts: number; max_attempts: number },
  errorCode: string
): Promise<"retrying" | "dead_letter"> {
  const outcome = resolveFailure({
    errorCode,
    attempts: job.attempts,
    maxAttempts: job.max_attempts,
    nowMs: Date.now()
  });

  await admin
    .from("jobs")
    .update({
      status: outcome.status,
      run_at: outcome.nextRunAtMs ? new Date(outcome.nextRunAtMs).toISOString() : new Date().toISOString(),
      last_error_code: errorCode,
      last_error_at: new Date().toISOString(),
      locked_at: null,
      locked_by: null
    })
    .eq("id", job.id);

  return outcome.status === "dead_letter" ? "dead_letter" : "retrying";
}

/**
 * One tick: enqueue what's due, then drain a bounded batch. Bounded so a
 * single invocation can't exceed the platform's function time limit — the next
 * tick picks up the rest.
 */
export async function runTick(admin: Admin, workerId: string): Promise<TickResult> {
  const result: TickResult = { enqueued: 0, processed: 0, succeeded: 0, failed: 0, deadLettered: 0 };

  result.enqueued = await enqueueDueSchedules(admin);

  const { data: claimed, error } = await admin.rpc("claim_jobs", {
    p_worker: workerId,
    p_limit: MAX_JOBS_PER_TICK,
    p_stale_seconds: STALE_LOCK_SECONDS
  });

  if (error) {
    logBackendEvent("warn", { route: "jobs/tick", errorType: errorType(error) });
    return result;
  }

  for (const job of claimed ?? []) {
    result.processed += 1;
    const handler = JOB_HANDLERS[job.job_type as JobType];

    if (!handler) {
      // An unknown type will never succeed — dead-letter it rather than spin.
      await failJob(admin, job, "RESOURCE_NOT_FOUND");
      result.deadLettered += 1;
      continue;
    }

    const startedAt = Date.now();
    try {
      const count = await handler(admin, (job.payload ?? {}) as Record<string, unknown>);
      await completeJob(admin, job.id);
      result.succeeded += 1;
      logBackendEvent("info", {
        route: "jobs/run",
        latencyMs: Date.now() - startedAt,
        // Counts only — a job payload may reference private resources.
        statusCode: 200
      });
      void count;
    } catch (caught) {
      const code = caught instanceof JobError ? caught.code : "INTERNAL_ERROR";
      const outcome = await failJob(admin, job, code);
      result.failed += 1;
      if (outcome === "dead_letter") result.deadLettered += 1;
      logBackendEvent("warn", {
        route: "jobs/run",
        latencyMs: Date.now() - startedAt,
        errorType: code
      });
    }
  }

  return result;
}

/** Queue health for the readiness probe / alerting (spec §52, §54). */
export async function queueHealth(admin: Admin) {
  const nowIso = new Date().toISOString();
  const [{ count: backlog }, { count: deadLetter }, { data: oldest }] = await Promise.all([
    admin
      .from("jobs")
      .select("id", { count: "exact", head: true })
      .in("status", ["queued", "scheduled", "retrying"])
      .lte("run_at", nowIso),
    admin.from("jobs").select("id", { count: "exact", head: true }).eq("status", "dead_letter"),
    admin
      .from("jobs")
      .select("run_at")
      .in("status", ["queued", "scheduled", "retrying"])
      .order("run_at", { ascending: true })
      .limit(1)
      .maybeSingle()
  ]);

  const oldestAgeMs = oldest?.run_at ? Date.now() - Date.parse(oldest.run_at) : 0;
  return assessQueueHealth({
    backlog: backlog ?? 0,
    deadLetter: deadLetter ?? 0,
    oldestAgeMs: Math.max(0, oldestAgeMs)
  });
}
