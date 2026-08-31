import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  SCHEDULER_SOURCES,
  UNKNOWN_SCHEDULER_SOURCE,
  buildTickSummary,
  resolveSchedulerSource,
  workerIdFor
} from "@/lib/jobs/scheduler-source";
import { periodicIdempotencyKey, SCHEDULE } from "@/lib/jobs/rules";
import { stripComments } from "@/lib/content/strip-comments";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

/** The migration that defines the claim function. */
const claimSql = read("supabase/migrations/20260717280000_jobs_idempotency_events.sql");
const worker = read("lib/jobs/worker.ts");
const handlers = read("lib/jobs/handlers.ts");
const workflow = read(".github/workflows/cron-tick.yml");
const route = read("app/api/cron/tick/route.ts");

const NOW = Date.UTC(2026, 7, 6, 12, 0, 0);
const MIN = 60_000;

// ---------------------------------------------------------------------------
// Claiming: two ticks cannot take the same job
// ---------------------------------------------------------------------------

describe("atomic claim", () => {
  it("claims rows with FOR UPDATE SKIP LOCKED", () => {
    // This is what makes two overlapping ticks safe: the second transaction
    // skips rows the first has locked rather than waiting and re-reading them.
    const claim = claimSql.slice(claimSql.indexOf("function public.claim_jobs"));
    expect(claim).toContain("for update skip locked");
  });

  it("flips status to processing inside the same statement that selects", () => {
    // Select-then-update in two statements would leave a window where both
    // workers saw the row as claimable. One UPDATE ... RETURNING closes it.
    const claim = claimSql.slice(claimSql.indexOf("function public.claim_jobs"));
    expect(claim).toContain("update public.jobs j");
    expect(claim).toContain("set status = 'processing'");
    expect(claim).toContain("returning j.*");
  });

  it("records which worker holds the claim", () => {
    const claim = claimSql.slice(claimSql.indexOf("function public.claim_jobs"));
    expect(claim).toContain("locked_by = p_worker");
    expect(claim).toContain("locked_at = now()");
  });

  it("only considers work that is actually due", () => {
    const claim = claimSql.slice(claimSql.indexOf("function public.claim_jobs"));
    expect(claim).toContain("status in ('queued', 'scheduled', 'retrying') and run_at <= now()");
  });

  it("is reachable only by the service role", () => {
    const security = read("supabase/migrations/20260719160000_client_exposure_security_hardening.sql");
    expect(security).toContain(
      "revoke all on function public.claim_jobs(text, integer, integer) from public, anon, authenticated;"
    );
    expect(security).toContain("grant execute on function public.claim_jobs(text, integer, integer) to service_role;");
  });
});

// ---------------------------------------------------------------------------
// Crash recovery
// ---------------------------------------------------------------------------

describe("crash recovery", () => {
  it("reclaims work orphaned by a crashed worker", () => {
    // Without this a worker dying mid-job would strand it in `processing`
    // forever, and a safety alert would never fire.
    const claim = claimSql.slice(claimSql.indexOf("function public.claim_jobs"));
    expect(claim).toContain("status = 'processing' and locked_at < now() - make_interval(secs => p_stale_seconds)");
  });

  it("uses a bounded lease rather than an indefinite lock", () => {
    expect(worker).toContain("STALE_LOCK_SECONDS");
  });

  it("counts the attempt when the job is claimed, not when it finishes", () => {
    // A worker that crashes still burns an attempt, so a job that reliably
    // kills its worker reaches the dead letter instead of looping forever.
    const claim = claimSql.slice(claimSql.indexOf("function public.claim_jobs"));
    expect(claim).toContain("attempts = j.attempts + 1");
  });
});

// ---------------------------------------------------------------------------
// Enqueue idempotency
// ---------------------------------------------------------------------------

describe("periodic enqueue idempotency", () => {
  it("collapses the same period to one key", () => {
    // Two ticks inside one 5-minute bucket produce the identical key, so the
    // unique index turns the second insert into a no-op.
    const a = periodicIdempotencyKey("safe_arrival.unconfirmed_alert", 5, NOW);
    const b = periodicIdempotencyKey("safe_arrival.unconfirmed_alert", 5, NOW + 2 * MIN);
    expect(a).toBe(b);
  });

  it("produces a new key once the period rolls over", () => {
    const a = periodicIdempotencyKey("safe_arrival.unconfirmed_alert", 5, NOW);
    const b = periodicIdempotencyKey("safe_arrival.unconfirmed_alert", 5, NOW + 5 * MIN);
    expect(a).not.toBe(b);
  });

  it("keeps job types independent", () => {
    expect(periodicIdempotencyKey("safe_arrival.unconfirmed_alert", 5, NOW)).not.toBe(
      periodicIdempotencyKey("media.delete_queued", 5, NOW)
    );
  });

  it("is enforced by a unique index, not by application timing", () => {
    // Scheduler cadence must never be the deduplication mechanism.
    expect(claimSql).toContain("create unique index if not exists jobs_idempotency_unique");
    expect(claimSql).toContain("on public.jobs(idempotency_key)");
  });

  it("treats a unique violation as success rather than an error", () => {
    expect(worker).toContain("// A unique violation means this period is already enqueued, expected.");
  });

  it("gives two schedulers firing together the same key", () => {
    // The whole point: supabase_cron and github_backstop landing in the same
    // bucket enqueue one row between them.
    const supabaseTick = periodicIdempotencyKey("safe_arrival.unconfirmed_alert", 5, NOW + 1_000);
    const githubTick = periodicIdempotencyKey("safe_arrival.unconfirmed_alert", 5, NOW + 4_000);
    expect(supabaseTick).toBe(githubTick);
  });
});

// ---------------------------------------------------------------------------
// Vercel usage optimization: idle ticks stop attempting every insert
// ---------------------------------------------------------------------------

/**
 * enqueueDueSchedules used to loop all twenty SCHEDULE entries and attempt an
 * insert for each, relying on the unique index above to reject the ones not
 * yet due. isScheduleDue (lib/jobs/rules.ts) now filters the loop itself, so
 * the database only ever sees an insert attempt on the tick that is actually
 * due -- the index stays exactly as it was, as the guarantee for concurrent
 * or overlapping ticks, not as the primary filter.
 */
describe("idle ticks no longer attempt every schedule", () => {
  it("filters SCHEDULE through isScheduleDue before the insert loop", () => {
    const enqueue = worker.slice(worker.indexOf("export async function enqueueDueSchedules"));
    const body = enqueue.slice(0, enqueue.indexOf("\n}"));
    expect(body).toContain("SCHEDULE.filter((spec) => isScheduleDue(spec, nowMs))");
    // The insert itself, and the comment explaining the index is still the
    // real guarantee, must both survive this change untouched.
    expect(body).toContain("admin.from(\"jobs\").insert(");
    expect(body).toContain("// A unique violation means this period is already enqueued, expected.");
  });

  it("imports the due check from the one place it is defined", () => {
    expect(worker).toContain('from "@/lib/jobs/rules"');
    expect(worker).toContain("isScheduleDue");
  });
});

// ---------------------------------------------------------------------------
// Vercel usage optimization: scheduler health throttled independent of work
// ---------------------------------------------------------------------------

/**
 * checkSchedulerHealthAndAlert used to run on every tick unconditionally --
 * two more DB reads (cron.job_run_details via RPC, then scheduler_incidents)
 * purely to re-confirm health that had not changed since the last tick five
 * minutes earlier. It is now gated by isSchedulerHealthCheckDue, which cannot
 * weaken detection: the function only ever runs from inside a tick that IS
 * executing, so a scheduler that has actually stopped produces zero calls
 * regardless of any throttle here.
 */
describe("scheduler health check runs on its own cadence", () => {
  it("gates the health check behind isSchedulerHealthCheckDue", () => {
    expect(route).toContain("isSchedulerHealthCheckDue(Date.now())");
    const gated = route.slice(route.indexOf("isSchedulerHealthCheckDue(Date.now())"));
    expect(gated.slice(0, 300)).toContain("checkSchedulerHealthAndAlert(admin)");
  });

  it("still never lets a health-check failure fail the tick", () => {
    // The try/catch around the call must survive the new gate wrapping it.
    const gated = route.slice(route.indexOf("isSchedulerHealthCheckDue(Date.now())"));
    expect(gated.slice(0, 500)).toContain("try {");
    expect(gated.slice(0, 500)).toContain("} catch {");
  });

  it("imports the gate from the same rules module as the schedule check", () => {
    expect(route).toContain('from "@/lib/jobs/rules"');
    expect(route).toContain("isSchedulerHealthCheckDue");
  });
});

// ---------------------------------------------------------------------------
// Overdue catch-up
// ---------------------------------------------------------------------------

describe("overdue catch-up", () => {
  it("claims anything whose run_at has passed, however long ago", () => {
    // A missed tick must not lose work: the next tick sweeps up everything
    // already due rather than only what became due since.
    const claim = claimSql.slice(claimSql.indexOf("function public.claim_jobs"));
    expect(claim).toContain("run_at <= now()");
    expect(claim).not.toContain("run_at > now() - ");
  });

  it("takes the oldest and highest priority first", () => {
    const claim = claimSql.slice(claimSql.indexOf("function public.claim_jobs"));
    expect(claim).toContain("order by priority asc, run_at asc");
  });

  it("keeps Safe Arrival at the highest priority", () => {
    const spec = SCHEDULE.find((entry) => entry.jobType === "safe_arrival.unconfirmed_alert");
    expect(spec?.priority).toBe(1);
    expect(spec?.everyMinutes).toBe(5);
  });

  it("bounds a single tick so one invocation cannot run forever", () => {
    expect(worker).toContain("MAX_JOBS_PER_TICK");
  });
});

// ---------------------------------------------------------------------------
// Failure isolation
// ---------------------------------------------------------------------------

describe("failure handling", () => {
  it("does not let one failing job abandon the rest of the batch", () => {
    // Each job is handled inside the loop's own try/catch.
    const loop = worker.slice(worker.indexOf("for (const job of claimed"));
    expect(loop).toContain("try {");
    expect(loop).toContain("} catch");
    expect(loop).not.toContain("throw caught");
  });

  it("dead-letters a job type that can never succeed", () => {
    expect(worker).toContain("// An unknown type will never succeed, dead-letter it rather than spin.");
  });

  it("keeps a permanent failure inspectable rather than deleting it", () => {
    expect(worker).toContain('"dead_letter"');
    expect(claimSql).toContain("last_error_code");
    expect(claimSql).toContain("last_error_at");
  });

  it("caps retries", () => {
    expect(claimSql).toContain("max_attempts integer not null default 5");
  });
});

// ---------------------------------------------------------------------------
// Safe Arrival: a second, independent guard
// ---------------------------------------------------------------------------

describe("Safe Arrival duplicate alert protection", () => {
  const alert = handlers.slice(
    handlers.indexOf("export const handleSafeArrivalUnconfirmedAlert"),
    handlers.indexOf("// Media deletion")
  );

  it("claims the alert with a compare-and-swap before sending", () => {
    // Independent of the job claim: even if two workers somehow ran the same
    // job, only one wins this update and the other sends nothing.
    expect(alert).toContain('.is("unconfirmed_notified_at", null)');
    expect(alert).toContain("if (!claimed?.length) continue;");
  });

  it("claims BEFORE notifying, never after", () => {
    // Notify-then-claim would double-send whenever the claim lost the race.
    // Compared against the CALL, not the import at the top of the file.
    expect(alert.indexOf('.is("unconfirmed_notified_at", null)')).toBeLessThan(
      alert.indexOf("deliverNotification(admin, {")
    );
  });

  it("records the alert as an audited event", () => {
    expect(alert).toContain('.from("safe_arrival_events").insert({');
    expect(alert).toContain('event_type: "unconfirmed_alert"');
  });
});

// ---------------------------------------------------------------------------
// Scheduler source
// ---------------------------------------------------------------------------

describe("scheduler source", () => {
  it("recognises exactly the three canonical sources", () => {
    expect([...SCHEDULER_SOURCES]).toEqual(["supabase_cron", "github_backstop", "manual"]);
  });

  it("resolves each one", () => {
    expect(resolveSchedulerSource("supabase_cron")).toBe("supabase_cron");
    expect(resolveSchedulerSource("github_backstop")).toBe("github_backstop");
    expect(resolveSchedulerSource("manual")).toBe("manual");
  });

  it("maps anything unrecognised to unknown rather than rejecting it", () => {
    // A bad label must never stop due jobs running.
    for (const raw of [null, undefined, "", "   ", "vercel", "<script>", "SUPABASE_CRON!"]) {
      expect(resolveSchedulerSource(raw)).toBe(UNKNOWN_SCHEDULER_SOURCE);
    }
  });

  it("is case and whitespace tolerant", () => {
    expect(resolveSchedulerSource(" Supabase_Cron ")).toBe("supabase_cron");
  });

  it("names the worker so a stuck job is attributable", () => {
    expect(workerIdFor("supabase_cron", "abc123")).toBe("supabase_cron-abc123");
  });

  it("never changes job behaviour", () => {
    // The source is read for reporting only; nothing branches on it.
    const source = stripComments(read("lib/jobs/scheduler-source.ts"));
    for (const banned of ["claim_jobs", "runTick", "JOB_HANDLERS", "admin"]) {
      expect(source, `scheduler source must not touch ${banned}`).not.toContain(banned);
    }
    const handlerBranch = stripComments(worker);
    expect(handlerBranch).not.toContain("supabase_cron");
    expect(handlerBranch).not.toContain("github_backstop");
  });
});

// ---------------------------------------------------------------------------
// Tick summary
// ---------------------------------------------------------------------------

describe("tick summary", () => {
  const summary = buildTickSummary({
    source: "supabase_cron",
    tickId: "abc123",
    startedAtMs: NOW,
    completedAtMs: NOW + 1_500,
    considered: 4,
    claimed: 3,
    completed: 2,
    retried: 1,
    failed: 0
  });

  it("reports the counts and timings the brief asks for", () => {
    expect(summary).toEqual({
      source: "supabase_cron",
      tickId: "abc123",
      startedAt: new Date(NOW).toISOString(),
      completedAt: new Date(NOW + 1_500).toISOString(),
      durationMs: 1_500,
      jobsConsidered: 4,
      jobsClaimed: 3,
      jobsCompleted: 2,
      jobsRetried: 1,
      jobsFailed: 0
    });
  });

  it("never carries a payload, user content or a secret", () => {
    const source = stripComments(read("lib/jobs/scheduler-source.ts"));
    for (const banned of ["payload", "userId", "secret", "token", "latitude", "email"]) {
      expect(source, `summary must not include ${banned}`).not.toContain(banned);
    }
    // Counts only — every reported field is a number, a timestamp or the source.
    for (const [key, value] of Object.entries(summary)) {
      if (key === "source" || key === "tickId") continue;
      expect(typeof value === "number" || typeof value === "string", `${key}`).toBe(true);
    }
  });

  it("never reports a negative duration if clocks disagree", () => {
    const backwards = buildTickSummary({
      source: "manual",
      tickId: "x",
      startedAtMs: NOW + 1_000,
      completedAtMs: NOW,
      considered: 0,
      claimed: 0,
      completed: 0,
      retried: 0,
      failed: 0
    });
    expect(backwards.durationMs).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Endpoint and workflow wiring
// ---------------------------------------------------------------------------

describe("tick endpoint", () => {
  it("reads the source from the request and reports it", () => {
    expect(route).toContain('resolveSchedulerSource(new URL(request.url).searchParams.get("source"))');
    expect(route).toContain("buildTickSummary({");
  });

  it("still authenticates before doing anything", () => {
    // Compared against the CALL, not the import at the top of the file.
    expect(route.indexOf("if (!isAuthorized(request))")).toBeLessThan(
      route.indexOf("await runTick(admin")
    );
  });

  it("keeps both scheduler credentials independent", () => {
    expect(route).toContain("process.env.CRON_SECRET");
    expect(route).toContain("process.env.CRON_DB_SECRET");
  });

  it("compares secrets in constant time and fails closed", () => {
    expect(route).toContain("timingSafeEqual");
    expect(route).toContain("if (secrets.length === 0) return false;");
  });

  it("never confirms whether a secret was merely wrong", () => {
    expect(route).toContain('return NextResponse.json({ error: "Not found." }, { status: 404 });');
  });
});

describe("GitHub backstop", () => {
  it("runs on the backstop cadence, not the primary's", () => {
    // Tightened to */10 after the pg_cron incident; cadence itself is
    // asserted in scheduler-health.test.ts.
    expect(workflow).toContain('- cron: "*/10 * * * *"');
    expect(workflow).not.toContain('- cron: "*/5 * * * *"');
  });

  it("is documented as a backstop rather than the primary scheduler", () => {
    expect(workflow).toContain("RECOVERY BACKSTOP — NOT the primary scheduler.");
    expect(workflow).toContain("pg_cron");
  });

  it("identifies itself as the source", () => {
    expect(workflow).toContain("TICK_SOURCE: github_backstop");
    expect(workflow).toContain("?source=${TICK_SOURCE}");
  });

  it("keeps manual dispatch on the same code path", () => {
    expect(workflow).toContain("workflow_dispatch: {}");
  });

  it("still never cancels an in-progress tick", () => {
    expect(workflow).toContain("cancel-in-progress: false");
  });

  it("keeps its retry and fast-fail behaviour", () => {
    expect(workflow).toContain("for attempt in 1 2 3");
    expect(workflow).toContain("Authorisation or routing problem, not retrying.");
  });

  it("logs counts without leaking the secret", () => {
    expect(workflow).toContain("jobsClaimed");
    // The secret is only ever referenced as an env var, never echoed.
    expect(workflow).not.toContain("echo \"${CRON_SECRET}");
    expect(workflow).not.toContain("echo ${CRON_SECRET}");
  });
});

describe("pg_cron primary", () => {
  const migration = read("supabase/migrations/20260806200000_cron_tick_scheduler_source.sql");

  it("tags its ticks as supabase_cron", () => {
    expect(migration).toContain("source=supabase_cron");
  });

  it("appends the parameter without assuming the URL has no query string", () => {
    expect(migration).toContain("case when position('?' in v_url) > 0 then '&' else '?' end");
  });

  it("keeps credentials in Vault and out of the migration", () => {
    expect(migration).toContain("vault.decrypted_secrets");
    expect(migration).not.toMatch(/Bearer\s+[A-Za-z0-9_-]{8,}/);
  });

  it("still refuses to fire unauthenticated", () => {
    expect(migration).toContain("if v_url is null or v_secret is null then");
  });

  it("stays service-role only", () => {
    expect(migration).toContain("revoke all on function private.run_cron_tick() from public, anon, authenticated;");
    expect(migration).toContain("grant execute on function private.run_cron_tick() to service_role;");
  });

  it("documents its rollback", () => {
    expect(migration).toContain("Rollback:");
  });
});
