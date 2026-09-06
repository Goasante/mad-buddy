import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const migration = readFileSync(
  path.join(ROOT, "supabase", "migrations", "20260905194000_reports_browser_insert_authority.sql"),
  "utf8"
)
  .split(/\r?\n/)
  .map((line) => {
    const at = line.indexOf("--");
    return at === -1 ? line : line.slice(0, at);
  })
  .join("\n");
const action = readFileSync(path.join(ROOT, "app", "(app)", "actions.ts"), "utf8");

describe("SEC-003 reports authority", () => {
  it("removes table-wide browser DML before granting the narrow insert path", () => {
    expect(migration).toMatch(
      /revoke\s+insert\s*,\s*update\s*,\s*delete\s+on\s+table\s+public\.reports\s+from\s+public\s*,\s*anon\s*,\s*authenticated/i
    );
  });

  it("grants INSERT only on columns the signed-in report action actually writes", () => {
    const match = /grant\s+insert\s*\(([^)]*)\)\s+on\s+table\s+public\.reports\s+to\s+authenticated/i.exec(migration);
    expect(match).not.toBeNull();
    const cols = (match?.[1] ?? "").split(",").map((c) => c.trim());
    expect(cols.sort()).toEqual(["description", "reason", "reported_user_id", "reporter_id"].sort());
    for (const protectedColumn of ["status", "reported_user_label", "created_at", "updated_at", "id"]) {
      expect(cols).not.toContain(protectedColumn);
    }
  });

  it("keeps report creation tied to the authenticated reporter and open state", () => {
    expect(migration).toMatch(/for\s+insert\s+to\s+authenticated/i);
    expect(migration).toMatch(/auth\.uid\(\)\s*=\s*reporter_id/i);
    expect(migration).toMatch(/status\s*=\s*'open'::public\.report_status/i);
  });

  it("matches the real report action payload", () => {
    const at = action.indexOf('.from("reports").insert({');
    expect(at).toBeGreaterThan(-1);
    const payload = action.slice(at, at + 400);
    for (const column of ["reporter_id", "reported_user_id", "reason", "description"]) {
      expect(payload).toContain(column);
    }
    expect(payload).not.toContain("status:");
  });
});
