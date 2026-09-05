import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const MIGRATIONS = path.join(ROOT, "supabase", "migrations");
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

const localGrants = readFileSync(path.join(ROOT, "scripts", "hardening", "local-db-grants.sql"), "utf8")
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

describe("the local grant helper cannot mask browser authority defects", () => {
  it("contains no blanket table grant to anon or authenticated", () => {
    for (const s of localGrants.match(/grant\s+[^;]*on\s+all\s+tables\s+in\s+schema\s+public\s+to\s+[^;]*;/g) ?? []) {
      expect(s).not.toMatch(/\banon\b/);
      expect(s).not.toMatch(/\bauthenticated\b/);
    }
  });

  it("contains no browser-role default grant", () => {
    for (const s of localGrants.match(/alter\s+default\s+privileges[\s\S]*?;/g) ?? []) {
      expect(s).not.toMatch(/\banon\b/);
      expect(s).not.toMatch(/\bauthenticated\b/);
    }
  });

  it("still repairs service_role for local harnesses", () => {
    expect(localGrants).toMatch(/on\s+all\s+tables\s+in\s+schema\s+public\s+to\s+service_role/);
    expect(localGrants).toMatch(/on\s+all\s+sequences\s+in\s+schema\s+public\s+to\s+service_role/);
  });
});
