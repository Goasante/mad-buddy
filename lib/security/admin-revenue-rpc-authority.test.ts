import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const MIGRATIONS = path.join(ROOT, "supabase", "migrations");
const migration = readFileSync(
  path.join(MIGRATIONS, "20260906031500_admin_revenue_rpc_execute_authority.sql"),
  "utf8"
).toLowerCase();

const original = readFileSync(
  path.join(MIGRATIONS, "20260726180000_revenue_intelligence.sql"),
  "utf8"
).toLowerCase();

const FUNCTIONS = [
  "get_revenue_subscription_snapshot",
  "get_admin_media_storage_summary"
] as const;

describe("admin revenue RPC execute authority", () => {
  it.each(FUNCTIONS)("revokes browser execution from %s", (fn) => {
    const statement = migration.match(
      new RegExp(`revoke\\s+all\\s+privileges\\s+on\\s+function\\s+public\\.${fn}\\([^;]*?from\\s+public\\s*,\\s*anon\\s*,\\s*authenticated\\s*;`, "i")
    )?.[0];
    expect(statement, `${fn} must revoke PUBLIC, anon and authenticated`).toBeDefined();
  });

  it.each(FUNCTIONS)("restates service_role execution on %s", (fn) => {
    expect(migration).toMatch(
      new RegExp(`grant\\s+execute\\s+on\\s+function\\s+public\\.${fn}\\([^;]*?to\\s+service_role\\s*;`, "i")
    );
  });

  it("fails migration if browser execution remains effective", () => {
    for (const fn of FUNCTIONS) {
      expect(migration).toContain(`has_function_privilege('anon'`);
      expect(migration).toContain(`has_function_privilege('authenticated'`);
      expect(migration).toContain(fn);
    }
  });

  it("preserves the original service-only product contract", () => {
    // The original implementation already used the admin client and explicitly
    // granted these RPCs to service_role. This hotfix changes authority only.
    for (const fn of FUNCTIONS) {
      expect(original).toContain(`grant execute on function public.${fn}`);
    }
  });
});
