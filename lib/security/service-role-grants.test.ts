import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Fresh-database grant reproducibility.
 *
 * Applying every migration to a brand-new hosted Supabase project produced a
 * database the server could not use: service_role held SELECT on ~31 of 191
 * public tables and ordinary API calls failed with 42501. The schema was
 * reproducible; the ACLs were not.
 *
 * These tests assert the repair stays in the migration history, and -- just as
 * importantly -- that it never grows to include the browser roles. A grant
 * repair that widens `anon` or `authenticated` is how this becomes a data
 * exposure rather than an outage fix.
 */

const MIGRATIONS_DIR = path.join(process.cwd(), "supabase", "migrations");

const migrationFiles = readdirSync(MIGRATIONS_DIR)
  .filter((name) => name.endsWith(".sql"))
  .sort();

function read(name: string): string {
  return readFileSync(path.join(MIGRATIONS_DIR, name), "utf8");
}

/** Strip `--` comments so prose about grants is never mistaken for a grant. */
function statementsOf(sql: string): string {
  return sql
    .split(/\r?\n/)
    .map((line) => {
      const commentAt = line.indexOf("--");
      return commentAt === -1 ? line : line.slice(0, commentAt);
    })
    .join("\n")
    .toLowerCase();
}

const GRANT_MIGRATION = migrationFiles.find((name) =>
  name.includes("service_role_grant_reproducibility")
);

describe("service_role grant reproducibility", () => {
  it("ships a migration that repairs fresh-database service_role authority", () => {
    expect(GRANT_MIGRATION).toBeDefined();
  });

  const sql = statementsOf(read(GRANT_MIGRATION!));

  it("grants schema usage, without which table grants are unreachable", () => {
    expect(sql).toMatch(/grant\s+usage\s+on\s+schema\s+public\s+to\s+[^;]*service_role/);
  });

  it.each(["select", "insert", "update", "delete"])(
    "grants %s on all existing public tables",
    (privilege) => {
      const tableGrant = sql.match(
        /grant\s+([^;]*?)\s+on\s+all\s+tables\s+in\s+schema\s+public\s+to\s+([^;]*);/
      );
      expect(tableGrant, "expected a GRANT ... ON ALL TABLES IN SCHEMA public").not.toBeNull();
      expect(tableGrant![1]).toContain(privilege);
      expect(tableGrant![2]).toContain("service_role");
    }
  );

  it("grants sequence access, which INSERT on a serial column needs", () => {
    expect(sql).toMatch(
      /grant\s+[^;]*sequences\s+in\s+schema\s+public\s+to\s+[^;]*service_role/
    );
  });

  it("sets default privileges so the NEXT new table is not broken again", () => {
    // Without this, the very next migration that creates a table reintroduces
    // the defect for that table.
    const defaults = sql.match(/alter\s+default\s+privileges[\s\S]*?;/g) ?? [];
    expect(defaults.length).toBeGreaterThanOrEqual(2);

    const tableDefault = defaults.find((s) => /on\s+tables\s+to/.test(s));
    expect(tableDefault, "expected a default privilege for TABLES").toBeDefined();
    for (const privilege of ["select", "insert", "update", "delete"]) {
      expect(tableDefault!).toContain(privilege);
    }
    expect(tableDefault!).toContain("service_role");

    const sequenceDefault = defaults.find((s) => /on\s+sequences\s+to/.test(s));
    expect(sequenceDefault, "expected a default privilege for SEQUENCES").toBeDefined();
    expect(sequenceDefault!).toContain("service_role");
  });

  it("attaches default privileges to the role migrations actually run as", () => {
    // ALTER DEFAULT PRIVILEGES without FOR ROLE applies to the *current* role,
    // which silently does nothing for objects created by a different owner.
    for (const statement of sql.match(/alter\s+default\s+privileges[\s\S]*?;/g) ?? []) {
      expect(statement).toMatch(/for\s+role\s+postgres/);
    }
  });
});

describe("the repair must never widen browser authority", () => {
  const sql = statementsOf(read(GRANT_MIGRATION!));

  it("grants to service_role and to no other role", () => {
    // The whole defect is that a trusted BACKEND identity lost its grants.
    // anon and authenticated are constrained deliberately -- on this database
    // anon holds SELECT on 3 tables and authenticated on 4 -- and RLS is what
    // narrows them. Widening either here would turn an outage fix into a data
    // exposure.
    const grantTargets = [...sql.matchAll(/\bto\s+([a-z_,\s]+);/g)].map((m) => m[1]);
    expect(grantTargets.length).toBeGreaterThan(0);

    for (const target of grantTargets) {
      expect(target).toContain("service_role");
      expect(target).not.toContain("anon");
      expect(target).not.toContain("authenticated");
      expect(target).not.toContain("public");
    }
  });

  it("does not touch RLS, policies, or table data", () => {
    expect(sql).not.toMatch(/\bcreate\s+policy\b/);
    expect(sql).not.toMatch(/\bdrop\s+policy\b/);
    expect(sql).not.toMatch(/\balter\s+table\b/);
    expect(sql).not.toMatch(/\brow\s+level\s+security\b/);
    expect(sql).not.toMatch(/\b(insert\s+into|update\s+public|delete\s+from)\b/);
  });

  it("does not change function EXECUTE authority", () => {
    expect(sql).not.toMatch(/\bon\s+function\b/);
    expect(sql).not.toMatch(/\bexecute\b/);
  });
});

describe("the local-only grant script stays out of hosted migrations", () => {
  it("no migration grants broad DML to anon or authenticated", () => {
    // scripts/hardening/local-db-grants.sql intentionally grants broadly to the
    // browser roles for a disposable Docker stack. Copying that into a hosted
    // migration would expose every table to every signed-in user, bounded only
    // by RLS. This test is the guard against that being done "to fix grants".
    for (const name of migrationFiles) {
      const sql = statementsOf(read(name));
      const broad = sql.match(
        /grant\s+[^;]*\bon\s+all\s+tables\s+in\s+schema\s+public\s+to\s+([^;]*);/g
      );
      if (!broad) continue;

      for (const statement of broad) {
        expect(statement, `${name} grants broadly to anon`).not.toMatch(/\banon\b/);
        expect(statement, `${name} grants broadly to authenticated`).not.toMatch(
          /\bauthenticated\b/
        );
      }
    }
  });
});
