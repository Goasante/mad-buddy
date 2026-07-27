import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  join(process.cwd(), "supabase", "migrations", "20260727180000_feature_experiments.sql"),
  "utf8"
);

describe("feature experiments migration", () => {
  it("creates private canonical experiment tables with immutable evidence", () => {
    for (const table of [
      "experiments",
      "experiment_variants",
      "experiment_testers",
      "experiment_assignments",
      "experiment_exposures"
    ]) {
      expect(sql).toContain(`create table if not exists public.${table}`);
      expect(sql).toContain(`alter table public.${table} enable row level security`);
      expect(sql).toContain(`revoke all on table public.${table} from anon, authenticated`);
    }
    expect(sql).toContain("Experiment assignment and exposure evidence is immutable");
    expect(sql).toContain("unique (experiment_id, user_id)");
  });

  it("uses stable user hashes and never random client assignment", () => {
    expect(sql).toContain("hashtextextended(v_experiment.id::text || ':allocation:' || p_user_id::text");
    expect(sql).toContain("hashtextextended(v_experiment.id::text || ':variant:' || p_user_id::text");
    expect(sql).not.toContain("random()");
  });

  it("enforces parent flags, server plan targeting, conflicts, and actual exposure", () => {
    expect(sql).toContain("feature_flag_enabled_for_subject");
    expect(sql).toContain("current_experiment_plan");
    expect(sql).toContain("v_experiment.conflict_group");
    expect(sql).toContain("'conflict:' || v_experiment.conflict_group || ':' || p_user_id::text");
    expect(sql).toContain("record_experiment_exposure");
    expect(sql).toContain("'experiment_exposed'");
  });

  it("contains no location, coordinates, distance, route, or country targeting", () => {
    const experimentSection = sql.slice(0, sql.indexOf("capture_notification_opt_out_event"));
    expect(experimentSection).not.toMatch(/\blatitude\b|\blongitude\b|\bcoordinates?\b|\bdistance\b|\broute\b/i);
    expect(experimentSection).not.toContain("'country'");
  });

  it("preserves history during emergency stops and scheduled completion", () => {
    expect(sql).toContain("status in ('draft', 'scheduled', 'running', 'paused', 'completed', 'cancelled')");
    expect(sql).toContain("status = 'paused'");
    expect(sql).toContain("Experiment history cannot be deleted");
    expect(sql).toContain("process_experiment_schedules");
    expect(sql).toContain("insert into public.admin_audit_events");
  });

  it("anonymizes assignment subjects when an account is deleted", () => {
    expect(sql).toContain("references auth.users(id) on delete set null");
    expect(sql).toContain("old.user_id is not null");
    expect(sql).toContain("new.user_id is null");
  });

  it("cannot grant premium access or rewrite subscription state", () => {
    expect(sql).not.toMatch(/update\s+public\.subscriptions/i);
    expect(sql).not.toMatch(/insert\s+into\s+public\.premium_trials/i);
    expect(sql).not.toMatch(/update\s+public\.premium_trials/i);
  });
});
