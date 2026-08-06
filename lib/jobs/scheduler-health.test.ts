import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CONSECUTIVE_FAILURE_ALERT_THRESHOLD,
  MISSING_TICK_ALERT_MS,
  assessSchedulerHealth,
  hasRecovered,
  shouldSendAlert,
  type TickRun
} from "@/lib/jobs/scheduler-health";
import { stripComments } from "@/lib/content/strip-comments";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const NOW = Date.UTC(2026, 7, 6, 20, 20, 0);
const MIN = 60_000;

const run = (minutesAgo: number, status: "succeeded" | "failed"): TickRun => ({
  startedAtMs: NOW - minutesAgo * MIN,
  status
});

/** A healthy 5-minute cadence. */
const healthy: TickRun[] = [run(0, "succeeded"), run(5, "succeeded"), run(10, "succeeded")];

// ---------------------------------------------------------------------------
// Health assessment
// ---------------------------------------------------------------------------

describe("scheduler health", () => {
  it("is healthy when recent ticks succeed", () => {
    const health = assessSchedulerHealth(healthy, NOW);
    expect(health.state).toBe("healthy");
    expect(health.consecutiveFailures).toBe(0);
    expect(health.shouldAlert).toBe(false);
  });

  it("is only degraded after one failure", () => {
    // A single blip is usually a cold start; the next tick fixes it.
    const health = assessSchedulerHealth([run(0, "failed"), run(5, "succeeded")], NOW);
    expect(health.state).toBe("degraded");
    expect(health.shouldAlert).toBe(false);
  });

  it("alerts on the second consecutive failure", () => {
    // This is the incident that motivated the module: two failed ticks in a
    // row, ~10 minutes of a safety job not running.
    const health = assessSchedulerHealth(
      [run(0, "failed"), run(5, "failed"), run(10, "succeeded")],
      NOW
    );
    expect(health.state).toBe("down");
    expect(health.consecutiveFailures).toBe(2);
    expect(health.shouldAlert).toBe(true);
  });

  it("keeps counting past the threshold", () => {
    const health = assessSchedulerHealth(
      [run(0, "failed"), run(5, "failed"), run(10, "failed"), run(15, "succeeded")],
      NOW
    );
    expect(health.consecutiveFailures).toBe(3);
  });

  it("stops counting at the last success", () => {
    const health = assessSchedulerHealth(
      [run(0, "failed"), run(5, "succeeded"), run(10, "failed"), run(15, "failed")],
      NOW
    );
    // Only the newest failure is consecutive; the older pair already recovered.
    expect(health.consecutiveFailures).toBe(1);
  });

  it("reports when the last success was", () => {
    const health = assessSchedulerHealth([run(0, "failed"), run(5, "succeeded")], NOW);
    expect(health.lastSuccessAtMs).toBe(NOW - 5 * MIN);
    expect(health.minutesSinceSuccess).toBe(5);
  });

  it("does not trust the order it is given", () => {
    const scrambled = [run(10, "succeeded"), run(0, "failed"), run(5, "failed")];
    expect(assessSchedulerHealth(scrambled, NOW).consecutiveFailures).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Missing ticks
// ---------------------------------------------------------------------------

describe("missing ticks", () => {
  it("treats a stopped scheduler as down, not healthy", () => {
    // The subtle failure: the newest run SUCCEEDED, but that was an hour ago.
    // Anything only checking the newest status would call this healthy.
    const health = assessSchedulerHealth([run(60, "succeeded"), run(65, "succeeded")], NOW);
    expect(health.missing).toBe(true);
    expect(health.state).toBe("down");
    expect(health.shouldAlert).toBe(true);
  });

  it("treats no history at all as down", () => {
    const health = assessSchedulerHealth([], NOW);
    expect(health.state).toBe("down");
    expect(health.lastSuccessAtMs).toBeNull();
    expect(health.summary).toBe("No scheduler ticks recorded.");
  });

  it("tolerates one skipped slot", () => {
    // ~2 intervals of slack, so a single missed slot is not an alarm.
    const health = assessSchedulerHealth([run(8, "succeeded"), run(13, "succeeded")], NOW);
    expect(health.missing).toBe(false);
    expect(health.state).toBe("healthy");
  });

  it("uses a threshold of a couple of intervals", () => {
    expect(MISSING_TICK_ALERT_MS).toBeGreaterThan(2 * 5 * MIN);
    expect(MISSING_TICK_ALERT_MS).toBeLessThanOrEqual(15 * MIN);
  });
});

// ---------------------------------------------------------------------------
// Alert lifecycle
// ---------------------------------------------------------------------------

describe("alert lifecycle", () => {
  const down = assessSchedulerHealth([run(0, "failed"), run(5, "failed")], NOW);

  it("alerts once for an incident", () => {
    expect(shouldSendAlert(down, false)).toBe(true);
    // Already paged: do not page again for the same ongoing outage.
    expect(shouldSendAlert(down, true)).toBe(false);
  });

  it("never alerts while healthy", () => {
    expect(shouldSendAlert(assessSchedulerHealth(healthy, NOW), false)).toBe(false);
  });

  it("recovers automatically once ticks resume", () => {
    const recovered = assessSchedulerHealth(healthy, NOW);
    expect(hasRecovered(recovered, true)).toBe(true);
    // And a fresh incident can then alert again.
    expect(shouldSendAlert(down, false)).toBe(true);
  });

  it("does not report recovery when nothing was alerted", () => {
    expect(hasRecovered(assessSchedulerHealth(healthy, NOW), false)).toBe(false);
  });

  it("alerts on the second failure, matching the documented threshold", () => {
    expect(CONSECUTIVE_FAILURE_ALERT_THRESHOLD).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Safety of what is reported
// ---------------------------------------------------------------------------

describe("alert content", () => {
  it("summarises without exposing anything private", () => {
    const health = assessSchedulerHealth([run(0, "failed"), run(5, "failed")], NOW);
    expect(health.summary).toBe("2 consecutive failed ticks.");
    for (const banned of ["Bearer", "secret", "token", "payload", "@"]) {
      expect(health.summary).not.toContain(banned);
    }
  });

  it("holds no secrets or payloads in the module at all", () => {
    const source = stripComments(read("lib/jobs/scheduler-health.ts"));
    for (const banned of ["secret", "token", "payload", "Bearer", "vault", "service_role"]) {
      expect(source, `health module must not reference ${banned}`).not.toContain(banned);
    }
  });

  it("is pure", () => {
    const source = stripComments(read("lib/jobs/scheduler-health.ts"));
    for (const banned of ["createSupabase", "fetch(", "Math.random", "useState"]) {
      expect(source).not.toContain(banned);
    }
  });
});

// ---------------------------------------------------------------------------
// Regression guard: every definition of run_cron_tick
// ---------------------------------------------------------------------------

describe("run_cron_tick regression guard", () => {
  const migrationsDir = join(process.cwd(), "supabase", "migrations");
  const definitions = readdirSync(migrationsDir)
    .filter((file) => file.endsWith(".sql"))
    .map((file) => ({ file, sql: readFileSync(join(migrationsDir, file), "utf8") }))
    .filter((entry) => entry.sql.includes("function private.run_cron_tick"));

  it("finds the definitions to check", () => {
    // If this ever hits zero the guard below is silently vacuous.
    expect(definitions.length).toBeGreaterThanOrEqual(2);
  });

  it("keeps the dynamic pg_net schema resolution after the July fix", () => {
    // THE incident: a later migration redefined this function from the ORIGINAL
    // July body and reverted 20260723200000_cron_tick_net_schema.sql, so every
    // tick failed with "function extensions.http_get does not exist".
    //
    // Only definitions from that fix onward are checked — the two earlier ones
    // are the history that led to it.
    const NET_SCHEMA_FIX = "20260723200000";
    const afterFix = definitions.filter((entry) => entry.file >= NET_SCHEMA_FIX);
    expect(afterFix.length).toBeGreaterThanOrEqual(1);

    for (const { file, sql } of afterFix) {
      const body = sql.slice(sql.indexOf("function private.run_cron_tick"));
      expect(body, `${file} must resolve pg_net's schema at call time`).toContain("pg_catalog.pg_proc");
      expect(body, `${file} must look up http_get`).toContain("proname = 'http_get'");
    }
  });

  it("never hardcodes a pg_net schema in a post-fix definition", () => {
    const afterFix = definitions.filter((entry) => entry.file >= "20260723200000");
    for (const { file, sql } of afterFix) {
      const body = stripComments(sql.slice(sql.indexOf("function private.run_cron_tick")));
      for (const banned of ["extensions.http_get", "net.http_get", "public.http_get", "extensions.net.http_post"]) {
        expect(body, `${file} must not hardcode ${banned}`).not.toContain(banned);
      }
    }
  });

  it("keeps the scheduler source in the newest definition", () => {
    const newest = definitions[definitions.length - 1]!;
    expect(newest.sql).toContain("source=supabase_cron");
  });

  it("never fires unauthenticated", () => {
    for (const { file, sql } of definitions) {
      const body = sql.slice(sql.indexOf("function private.run_cron_tick"));
      expect(body, `${file} must refuse to call without credentials`).toContain(
        "if v_url is null or v_secret is null then"
      );
    }
  });

  it("never embeds a credential in a migration", () => {
    for (const { file, sql } of definitions) {
      expect(sql, `${file} must read the secret from Vault`).toContain("vault.decrypted_secrets");
      expect(sql, `${file} must not inline a bearer token`).not.toMatch(/Bearer\s+[A-Za-z0-9._-]{12,}/);
    }
  });

  it("stays service-role only in every definition", () => {
    for (const { file, sql } of definitions) {
      expect(sql, `${file} must revoke public access`).toContain(
        "revoke all on function private.run_cron_tick() from public, anon, authenticated;"
      );
    }
  });
});

// ---------------------------------------------------------------------------
// GitHub backstop cadence
// ---------------------------------------------------------------------------

describe("GitHub backstop", () => {
  const workflow = read(".github/workflows/cron-tick.yml");

  it("runs every 10 minutes", () => {
    // Tightened from 30: during the incident the primary was down for ~10
    // minutes and a 30-minute backstop covered none of it.
    expect(workflow).toContain('- cron: "*/10 * * * *"');
  });

  it("keeps manual dispatch and the no-cancel policy", () => {
    expect(workflow).toContain("workflow_dispatch: {}");
    expect(workflow).toContain("cancel-in-progress: false");
  });

  it("still hits the same authenticated endpoint and tags its source", () => {
    expect(workflow).toContain("TICK_SOURCE: github_backstop");
    expect(workflow).toContain("?source=${TICK_SOURCE}");
    expect(workflow).toContain("Authorization: Bearer ${CRON_SECRET}");
  });
});

// ---------------------------------------------------------------------------
// Owner alert delivery
// ---------------------------------------------------------------------------

describe("owner alert wiring", () => {
  const alerts = read("lib/jobs/scheduler-alerts.ts");

  it("keeps the decision module free of delivery concerns", () => {
    // scheduler-health.ts decides; scheduler-alerts.ts delivers.
    const health = stripComments(read("lib/jobs/scheduler-health.ts"));
    for (const banned of ["deliverNotification", "admin_users", "supabase", "notification"]) {
      expect(health, `health module must not know about ${banned}`).not.toContain(banned);
    }
    expect(alerts).toContain("assessSchedulerHealth(runs, nowMs)");
  });

  it("reuses the existing notification pipeline", () => {
    expect(alerts).toContain('from "@/lib/notifications/server"');
    expect(alerts).toContain("deliverNotification(admin, {");
    // No new channel, no third-party monitoring.
    for (const banned of ["Sentry", "datadog", "webhook", "fetch("]) {
      expect(stripComments(alerts), `must not introduce ${banned}`).not.toContain(banned);
    }
  });

  it("uses the existing system_alert type", () => {
    expect(alerts).toContain('type: "system_alert"');
  });

  it("targets Owners only", () => {
    expect(alerts).toContain('.eq("role", "owner")');
    expect(alerts).toContain('.is("disabled_at", null)');
    // Never admins, never support, never ordinary users.
    expect(alerts).not.toContain('"admin")');
    expect(alerts).not.toContain('"support")');
  });

  it("skips an Owner with no linked auth user rather than failing", () => {
    expect(alerts).toContain("filter((id): id is string => Boolean(id))");
  });

  it("sends at critical priority so quiet hours cannot suppress it", () => {
    expect(alerts).toContain('priority: "critical"');
  });
});

describe("incident lifecycle", () => {
  const alerts = read("lib/jobs/scheduler-alerts.ts");

  it("does nothing while merely degraded", () => {
    // One failed tick is a blip; the threshold lives in the health module.
    expect(alerts).toContain("if (!health.shouldAlert) return { action: \"none\", health };");
  });

  it("opens exactly one incident and alerts once", () => {
    expect(alerts).toContain('.is("resolved_at", null)');
    expect(alerts).toContain("if (open.alerted_at) return { action: \"none\", health };");
  });

  it("claims the alert with a compare-and-swap", () => {
    // Two concurrent ticks: only one wins the update, only one notifies.
    expect(alerts).toContain('.is("alerted_at", null)');
    expect(alerts).toContain("if (!claimed?.length) return { action: \"none\", health };");
  });

  it("stays quiet when it loses the create race", () => {
    expect(alerts).toContain("if (error || !created) return { action: \"none\", health };");
  });

  it("claims the resolution before announcing recovery", () => {
    const recovery = alerts.slice(alerts.indexOf('if (health.state === "healthy")'));
    expect(recovery.indexOf('.is("resolved_at", null)')).toBeLessThan(recovery.indexOf("notifyOwners"));
  });

  it("reports outage duration, failed ticks and recovery time", () => {
    expect(alerts).toContain("Outage duration:");
    expect(alerts).toContain("Failed ticks:");
    expect(alerts).toContain("Recovery time:");
    expect(alerts).toContain("Ticks resumed successfully.");
  });

  it("uses the approved incident wording", () => {
    expect(alerts).toContain('title: "Scheduler Health Alert"');
    expect(alerts).toContain("Scheduler status: DOWN");
    expect(alerts).toContain("Consecutive failures:");
    expect(alerts).toContain('title: "Scheduler Recovered"');
  });

  it("never reports a job payload, a user or a secret", () => {
    const rendered = stripComments(alerts);
    for (const banned of ["payload", "secret", "Bearer", "email", "latitude"]) {
      expect(rendered, `alert must not include ${banned}`).not.toContain(banned);
    }
  });
});

describe("incident persistence", () => {
  const migration = read("supabase/migrations/20260806210000_scheduler_incidents.sql");
  const alerts = read("lib/jobs/scheduler-alerts.ts");

  it("persists state in the database, not in memory", () => {
    // A serverless tick does not survive between invocations; in-memory state
    // would re-alert every five minutes and forget across a deployment.
    expect(alerts).toContain('.from("scheduler_incidents")');
    expect(stripComments(alerts)).not.toContain("let openIncident");
    expect(stripComments(alerts)).not.toContain("new Map<");
  });

  it("allows only one open incident, enforced by an index", () => {
    expect(migration).toContain("create unique index if not exists scheduler_incidents_one_open");
    expect(migration).toContain("where resolved_at is null");
  });

  it("records when the alert and the recovery were delivered", () => {
    expect(migration).toContain("alerted_at timestamptz");
    expect(migration).toContain("recovery_notified_at timestamptz");
  });

  it("stores counts and timestamps only", () => {
    // SQL comments stripped (stripComments handles JS syntax, not "--"), so
    // the header stating it stores no job payloads does not trip this.
    const columns = migration.replace(/^\s*--.*$/gm, "");
    for (const banned of ["payload", "user_id", "email", "secret"]) {
      expect(columns, `incident table must not store ${banned}`).not.toContain(banned);
    }
  });

  it("is operational data, unreachable by ordinary users", () => {
    expect(migration).toContain("alter table public.scheduler_incidents enable row level security;");
    expect(migration).toContain("revoke all on table public.scheduler_incidents from public, anon, authenticated;");
    expect(migration).toContain("grant select, insert, update on table public.scheduler_incidents to service_role;");
  });

  it("documents its rollback", () => {
    expect(migration).toContain("Rollback:");
  });
});

describe("tick integration", () => {
  const route = read("app/api/cron/tick/route.ts");

  it("checks health from the tick itself", () => {
    expect(route).toContain("await checkSchedulerHealthAndAlert(admin);");
  });

  it("never lets alerting break the tick", () => {
    // A missed health check is far less serious than a missed job.
    // The call sits inside its own try/catch, so an alerting fault cannot
    // turn a healthy tick into a failed one.
    const call = route.indexOf("await checkSchedulerHealthAndAlert(admin);");
    const guarded = route.slice(call - 200, call + 300);
    expect(guarded).toContain("try {");
    expect(guarded).toContain("} catch {");
  });

  it("runs after the jobs, so it cannot delay them", () => {
    // Compared against the CALL, not the import at the top of the file.
    expect(route.indexOf("await runTick(admin")).toBeLessThan(
      route.indexOf("await checkSchedulerHealthAndAlert(admin);")
    );
  });
});
