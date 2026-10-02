import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");
const migration = read("supabase/migrations/20261002095057_safe_arrival_v2_deadlines.sql");
const rules = read("lib/jobs/rules.ts");
const handlers = read("lib/jobs/handlers.ts");
const parts = read("components/safety/journey-parts.tsx");
const page = read("components/safety/safe-arrival-page.tsx");

describe("Safe Arrival v2 lightweight architecture", () => {
  it("uses per-session deadlines with the five-minute safety backstop intact", () => {
    expect(rules).toContain('| "safe_arrival.deadline_check"');
    expect(rules).toContain('{ jobType: "safe_arrival.unconfirmed_alert", everyMinutes: 5, priority: 1 }');
    expect(rules).not.toContain('{ jobType: "safe_arrival.deadline_check", everyMinutes:');
    expect(handlers).toContain('"safe_arrival.deadline_check": handleSafeArrivalDeadline');
    expect(migration).toContain("'safe_arrival.deadline_check'");
    expect(migration).toContain("public.process_safe_arrival_deadline");
  });

  it("schedules a deadline at start, after extension, and for final expiry", () => {
    expect(migration).toContain("p_expected_arrival_at + make_interval(mins=>p_grace_period_minutes)");
    expect(migration).toContain("v_next + make_interval(mins=>v.grace_period_minutes)");
    expect(migration).toContain("v_now + interval '12 hours'");
  });

  it("re-reads canonical state under a row lock before changing anything", () => {
    const processor = migration.slice(migration.indexOf("public.process_safe_arrival_deadline"));
    expect(processor).toContain("for update");
    expect(processor).toContain("if v.status in ('completed','cancelled','expired')");
    expect(processor).toContain("expected_arrival_at + make_interval");
  });

  it("keeps lifecycle RPCs server-only", () => {
    expect(migration).toContain("revoke all on function public.process_safe_arrival_deadline(uuid)");
    expect(migration).toContain("from public,anon,authenticated");
    expect(migration).toContain("grant execute on function public.process_safe_arrival_deadline(uuid)");
    expect(migration).toContain("to service_role");
  });

  it("shows status stages without inventing geographic progress", () => {
    expect(parts).toContain("export function JourneyStageRail");
    expect(parts).toContain('transit: "ON THE WAY"');
    expect(parts).toContain('overdue: "NEEDS UPDATE"');
    expect(parts).toContain("Journey status only · no live position shared");
    expect((page.match(/<JourneyStageRail journey=\{journey\} nowMs=\{nowMs\} \/>/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });
});
