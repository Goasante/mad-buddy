import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");
const migration = read("supabase/migrations/20261002100049_safe_arrival_deadline_architecture.sql");
const rules = read("lib/jobs/rules.ts");
const handlers = read("lib/jobs/handlers.ts");
const parts = read("components/safety/journey-parts.tsx");

describe("Safe Arrival lightweight deadline architecture", () => {
  it("uses an exact per-session deadline and keeps the periodic sweep as a backstop", () => {
    expect(rules).toContain('"safe_arrival.deadline"');
    expect(rules).toContain('"safe_arrival.unconfirmed_alert"');
    expect(handlers).toContain('"safe_arrival.deadline": handleSafeArrivalDeadline');
    expect(migration).toContain("safe-arrival-deadline:");
    expect(migration).toContain("process_safe_arrival_deadline");
    expect(migration).toContain("process_due_safe_arrivals");
  });

  it("makes stale deadline jobs harmless after an extension", () => {
    expect(migration).toContain("if now() < v_due then return 'not_due'");
    expect(migration).toContain("v_next+make_interval(mins=>v.grace_period_minutes)");
  });

  it("keeps progress privacy-safe", () => {
    const combined = (migration + parts).toLowerCase();
    for (const forbidden of ["latitude", "longitude", "watchposition", "getcurrentposition"]) {
      expect(combined).not.toContain(forbidden);
    }
    expect(parts).toContain("JourneyStageRail");
    expect(parts).toContain("No live location");
  });
});
