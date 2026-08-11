import { NextResponse } from "next/server";
import { randomUUID, timingSafeEqual } from "crypto";
import { runTick } from "@/lib/jobs/worker";
import { buildTickSummary, resolveSchedulerSource, workerIdFor } from "@/lib/jobs/scheduler-source";
import { checkSchedulerHealthAndAlert } from "@/lib/jobs/scheduler-alerts";
import { isSchedulerHealthCheckDue } from "@/lib/jobs/rules";
import { createRequestId, errorType, logBackendEvent } from "@/lib/observability/logger";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSupabaseServerEnv } from "@/lib/supabase/env";

/**
 * The cron tick (feature architecture batch 14). Vercel Cron calls this on a
 * schedule; it enqueues due periodic jobs and drains a bounded batch.
 *
 * Auth: a shared secret, compared in constant time. This endpoint runs
 * privileged work with the service role, so it must never be publicly
 * callable. It is NOT in the public route allowlist, but /api/* bypasses the
 * proxy (each API route self-authenticates), so this check is the only thing
 * standing in front of it.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function matchesSecret(header: string, secret: string): boolean {
  const expected = `Bearer ${secret}`;
  const provided = Buffer.from(header);
  const expectedBuffer = Buffer.from(expected);
  if (provided.length !== expectedBuffer.length) return false;
  return timingSafeEqual(provided, expectedBuffer);
}

function isAuthorized(request: Request): boolean {
  // Two independent callers, two independent credentials:
  //  - CRON_SECRET: the GitHub Actions workflow.
  //  - CRON_DB_SECRET: the pg_cron job inside Supabase, which is the reliable
  //    5-minute scheduler (GitHub throttles scheduled workflows to roughly
  //    hourly, which is too slow for safe_arrival.unconfirmed_alert).
  // Separate secrets mean either scheduler can be rotated or revoked on its
  // own without taking the other down.
  const secrets = [process.env.CRON_SECRET, process.env.CRON_DB_SECRET].filter(
    (value): value is string => Boolean(value)
  );
  // Fail closed: with no secret configured, the endpoint is unusable rather
  // than open.
  if (secrets.length === 0) return false;

  const header = request.headers.get("authorization") ?? "";
  // Not short-circuited: every configured secret is compared so the work done
  // does not reveal which one matched.
  return secrets.reduce((matched, secret) => matchesSecret(header, secret) || matched, false);
}

export async function GET(request: Request) {
  const requestId = createRequestId();
  const startedAt = Date.now();
  const route = "/api/cron/tick";

  if (!isAuthorized(request)) {
    logBackendEvent("warn", { requestId, route, statusCode: 401, latencyMs: Date.now() - startedAt });
    // Generic: don't confirm whether the secret is merely wrong or unset.
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const env = getSupabaseServerEnv();
  if (!env.url || !env.serviceRoleKey) {
    return NextResponse.json({ error: "Not configured." }, { status: 503 });
  }

  try {
    const admin = createSupabaseAdminClient();

    // Which scheduler fired this tick. Observability only — the work below is
    // identical whatever the answer, and an unrecognised value still runs
    // (refusing to process due jobs over a bad label would turn a cosmetic
    // problem into a missed safety alert).
    const source = resolveSchedulerSource(new URL(request.url).searchParams.get("source"));
    const tickId = randomUUID().slice(0, 8);
    const result = await runTick(admin, workerIdFor(source, tickId));

    // Check the scheduler's own health after the work is done, so a slow or
    // failing health check can never delay or fail the jobs themselves, and
    // only on the tick whose bucket calls for it. This is a cost throttle,
    // never a correctness one: a scheduler that has actually stopped ticking
    // produces no invocations at all, so there is no tick to skip and nothing
    // this check could miss by running less often on the healthy path. See
    // isSchedulerHealthCheckDue for why 15 minutes stays ahead of the
    // 12-minute missing-tick alarm.
    if (isSchedulerHealthCheckDue(Date.now())) {
      try {
        await checkSchedulerHealthAndAlert(admin);
      } catch {
        // Never let alerting break the tick. A missed health check is far less
        // serious than a missed job.
      }
    }

    const summary = buildTickSummary({
      source,
      tickId,
      startedAtMs: startedAt,
      completedAtMs: Date.now(),
      // enqueueDueSchedules reports what it added; the claim is what this tick
      // actually took on.
      considered: result.enqueued,
      claimed: result.processed,
      completed: result.succeeded,
      retried: result.failed - result.deadLettered,
      failed: result.deadLettered
    });

    logBackendEvent("info", {
      requestId,
      route,
      statusCode: 200,
      latencyMs: Date.now() - startedAt
    });
    // Counts and timings only: no payloads, no user content, no secrets.
    return NextResponse.json({ data: { ...result, tick: summary }, meta: { requestId }, error: null });
  } catch (caught) {
    logBackendEvent("error", {
      requestId,
      route,
      statusCode: 500,
      latencyMs: Date.now() - startedAt,
      errorType: errorType(caught)
    });
    return NextResponse.json(
      { data: null, meta: { requestId }, error: { code: "INTERNAL_ERROR", message: "Tick failed." } },
      { status: 500 }
    );
  }
}
