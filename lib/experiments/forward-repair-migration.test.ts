import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  join(
    process.cwd(),
    "supabase",
    "migrations",
    "20260815120000_experiment_function_forward_repairs.sql"
  ),
  "utf8"
).toLowerCase();

const repairedFunctions = [
  "record_product_event",
  "process_experiment_schedules",
  "experiment_structure_guard",
  "feature_flag_enabled_for_subject",
  "current_experiment_plan",
  "resolve_experiment_assignment",
  "record_experiment_exposure"
];

const serviceRoleFunctions = ["create_experiment_definition", ...repairedFunctions];

describe("experiment function forward repair migration", () => {
  it("replaces every affected function without rewriting tables or evidence", () => {
    for (const functionName of repairedFunctions) {
      expect(sql).toContain(`create or replace function public.${functionName}`);
    }
    expect(sql).not.toMatch(/\b(drop|truncate|delete\s+from|alter\s+table|create\s+table)\b/);
  });

  it("carries every validated lint and runtime repair forward", () => {
    expect(sql).toContain("'experiment', id,");
    expect(sql).not.toContain("'experiment', id::text");
    expect(sql).toContain("from public.experiment_variants as candidate_control");
    expect(sql).toContain("candidate_control.is_control");
    expect(sql).toContain(
      "on conflict on constraint experiment_assignments_experiment_id_user_id_key do nothing"
    );
    expect(sql).toContain(
      "on conflict on constraint experiment_exposures_experiment_id_user_id_key do nothing"
    );
    expect(sql).toContain("v_plan public.subscription_plan := 'free'::public.subscription_plan");
    expect(sql).toContain("if p_platform not in ('web', 'android', 'ios') then");
    expect(sql).toContain("if tg_op = 'update' and tg_table_name = 'experiment_testers' then");
  });

  it("reasserts service-role-only execution for every affected function", () => {
    for (const functionName of serviceRoleFunctions) {
      expect(sql).toMatch(
        new RegExp(`revoke all on function public\\.${functionName}\\([\\s\\S]*?from public, anon, authenticated;`)
      );
      expect(sql).toMatch(
        new RegExp(`grant execute on function public\\.${functionName}\\([\\s\\S]*?to service_role;`)
      );
    }
  });

  it("keeps fixed search paths and does not grant browser roles", () => {
    expect((sql.match(/set search_path = pg_catalog, public/g) ?? [])).toHaveLength(
      repairedFunctions.length
    );
    expect(sql).not.toMatch(/grant\s+execute[\s\S]*?to\s+(anon|authenticated)/);
  });
});
