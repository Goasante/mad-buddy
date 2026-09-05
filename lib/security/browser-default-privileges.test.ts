import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const MIGRATIONS = path.join(process.cwd(), "supabase", "migrations");
const sql = readFileSync(
  path.join(MIGRATIONS, "20260905193000_browser_default_privilege_normalization.sql"),
  "utf8"
)
  .split(/\r?\n/)
  .map((line) => {
    const at = line.indexOf("--");
    return at === -1 ? line : line.slice(0, at);
  })
  .join("\n")
  .toLowerCase();

function statement(owner: "supabase_admin" | "postgres", kind: "tables" | "sequences" | "functions") {
  const match = sql.match(
    new RegExp(
      `alter\\s+default\\s+privileges\\s+for\\s+role\\s+${owner}\\s+in\\s+schema\\s+public[\\s\\S]*?on\\s+${kind}[\\s\\S]*?;`,
      "i"
    )
  );
  return match?.[0] ?? "";
}

describe("browser default privileges are deny-by-default", () => {
  it.each(["supabase_admin", "postgres"] as const)("normalizes %s table defaults", (owner) => {
    const s = statement(owner, "tables");
    expect(s).not.toBe("");
    expect(s).toMatch(/revoke\s+all\s+privileges/);
    expect(s).toMatch(/from\s+public\s*,\s*anon\s*,\s*authenticated/);
  });

  it.each(["supabase_admin", "postgres"] as const)("normalizes %s sequence defaults", (owner) => {
    const s = statement(owner, "sequences");
    expect(s).not.toBe("");
    expect(s).toMatch(/revoke\s+all\s+privileges/);
    expect(s).toMatch(/from\s+public\s*,\s*anon\s*,\s*authenticated/);
  });

  it.each(["supabase_admin", "postgres"] as const)("normalizes %s function defaults", (owner) => {
    const s = statement(owner, "functions");
    expect(s).not.toBe("");
    expect(s).toMatch(/revoke\s+execute/);
    expect(s).toMatch(/from\s+public\s*,\s*anon\s*,\s*authenticated/);
  });

  it("does not subtract service_role authority", () => {
    expect(sql).not.toMatch(/from[^;]*service_role/);
  });

  it("does not touch type defaults", () => {
    expect(sql).not.toMatch(/on\s+types/);
  });
});
