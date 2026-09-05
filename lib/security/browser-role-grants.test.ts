import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Browser-role ACL contract.
 *
 * A fresh hosted database had 271 RLS policies and `authenticated` holding
 * SELECT on 4 of 191 tables, so /api/notifications returned 500 (42501) while
 * every unit test stayed green. RLS narrows access that a base GRANT must
 * first provide.
 *
 * These tests protect BOTH directions:
 *   - required grants must not disappear (the outage);
 *   - browser authority must not silently widen (the data exposure).
 */

const MIGRATIONS = path.join(process.cwd(), "supabase", "migrations");
const OPS = ["select", "insert", "update", "delete"] as const;

const files = readdirSync(MIGRATIONS)
  .filter((name) => name.endsWith(".sql"))
  .sort();

/** Strip `--` comments so prose about grants is never read as a grant. */
function sqlOf(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => {
      const at = line.indexOf("--");
      return at === -1 ? line : line.slice(0, at);
    })
    .join("\n");
}

const bySource = files.map((name) => ({
  name,
  sql: sqlOf(readFileSync(path.join(MIGRATIONS, name), "utf8"))
}));

const allSql = bySource.map((f) => f.sql).join("\n").toLowerCase();

const GRANT_MIGRATION = files.find((name) => name.includes("browser_role_grant_reproducibility"));
const grantSql = GRANT_MIGRATION
  ? sqlOf(readFileSync(path.join(MIGRATIONS, GRANT_MIGRATION), "utf8")).toLowerCase()
  : "";

type Statement = { ops: string[]; table: string; roles: string[] };

function parseGrants(sql: string): Statement[] {
  const out: Statement[] = [];
  for (const m of sql.matchAll(
    /\bgrant\s+([a-z,\s]+?)\s+on\s+(?:table\s+)?public\.([a-z_][a-z0-9_]*)\s+to\s+([a-z_,\s]+?)\s*;/g
  )) {
    const [, privs, table, roles] = m;
    out.push({
      ops: OPS.filter((op) => new RegExp(`\\b${op}\\b`).test(privs)),
      table,
      roles: roles.split(",").map((r) => r.trim())
    });
  }
  return out;
}

/** Does migration history explicitly revoke this op from this role? */
function isRevoked(table: string, role: string, op: string): boolean {
  const re = new RegExp(
    `revoke[^;]*\\b${op}\\b[^;]*\\bon\\s+(?:table\\s+)?public\\.${table}\\b[^;]*\\bfrom\\b[^;]*\\b${role}\\b`,
    "i"
  );
  return re.test(allSql);
}

describe("browser-role grant migration", () => {
  it("exists", () => {
    expect(GRANT_MIGRATION).toBeDefined();
  });

  it("restores the notifications read contract", () => {
    // The route queries notifications as the user; without this the API 500s.
    const statements = parseGrants(grantSql).filter((s) => s.table === "notifications");
    expect(statements.length).toBeGreaterThan(0);
    const authenticated = statements.filter((s) => s.roles.includes("authenticated"));
    expect(authenticated.length).toBe(1);
    expect(authenticated[0].ops).toEqual(["select"]);
  });

  it("grants schema usage to the browser roles", () => {
    expect(grantSql).toMatch(/grant\s+usage\s+on\s+schema\s+public\s+to[^;]*authenticated/);
  });

  it("is not a blanket grant", () => {
    // 39 of 191 tables. A jump toward "everything" means the derivation broke.
    expect(grantSql).not.toMatch(/on\s+all\s+tables\s+in\s+schema\s+public/);
    const tables = new Set(parseGrants(grantSql).map((s) => s.table));
    expect(tables.size).toBeGreaterThan(10);
    expect(tables.size).toBeLessThan(80);
  });
});

describe("deliberate security revokes are preserved", () => {
  /**
   * Tables whose authority a LATER migration deliberately narrowed.
   *
   * This test reads 20260903140000 -- the historical grant migration -- and
   * fails if anything it grants was revoked afterwards, on the reasoning that
   * a revoke is a security decision and re-granting undoes it. That direction
   * is right, but it cannot see the opposite move: revoke the broad grant and
   * re-grant something SMALLER.
   *
   * SEC-003 does exactly that. 20260903140000 gave `authenticated` table-wide
   * INSERT on `reports`, which let a reporter set `status` and file a report
   * already marked resolved. 20260905194000 revokes it and grants INSERT on
   * (reporter_id, reported_user_id, reason, description) only -- strictly less
   * authority, plus an RLS check pinning status to 'open'.
   *
   * Listing the table here asserts that narrowing was intentional. The
   * follow-up test below then proves it really is narrower, so an entry here
   * cannot be used to quietly restore table-wide authority.
   */
  const NARROWED_BY_LATER_MIGRATION = new Set(["reports"]);

  it("never grants an operation that migration history explicitly revoked", () => {
    // This is the invariant that separates a repair from a regression.
    for (const statement of parseGrants(grantSql)) {
      if (NARROWED_BY_LATER_MIGRATION.has(statement.table)) continue;
      for (const role of statement.roles) {
        if (role !== "anon" && role !== "authenticated") continue;
        for (const op of statement.ops) {
          expect(
            isRevoked(statement.table, role, op),
            `${statement.table}.${op} was explicitly revoked from ${role} but is granted back`
          ).toBe(false);
        }
      }
    }
  });

  it.each([...NARROWED_BY_LATER_MIGRATION])(
    "%s is narrowed to specific columns, never re-granted table-wide",
    (table) => {
      /* Only migrations AFTER the historical grant are examined: that grant is
         the broad one being narrowed, and it necessarily still exists in
         history. What matters is that nothing since has widened it back. */
      const laterSql = bySource
        .filter((f) => GRANT_MIGRATION !== undefined && f.name > GRANT_MIGRATION)
        .map((f) => f.sql)
        .join("\n")
        .toLowerCase();

      const tableWide = new RegExp(
        `\\bgrant\\s+[a-z,\\s]*\\b(?:insert|update|delete)\\b[a-z,\\s]*\\s+on\\s+(?:table\\s+)?public\\.${table}\\s+to\\s+[^;]*\\b(?:anon|authenticated)\\b`,
        "i"
      );
      expect(
        laterSql.match(tableWide),
        `${table} must stay column-scoped for browser roles, never re-granted table-wide`
      ).toBeNull();

      const columnScoped = new RegExp(
        `\\bgrant\\s+insert\\s*\\([^)]+\\)\\s*\\n?\\s*on\\s+(?:table\\s+)?public\\.${table}\\s+to\\s+authenticated`,
        "i"
      );
      expect(laterSql).toMatch(columnScoped);
    }
  );

  it.each([
    ["notifications", "insert"],
    ["notifications", "update"],
    ["notifications", "delete"],
    ["user_locations", "insert"],
    ["user_locations", "update"],
    ["user_locations", "delete"],
    ["friendships", "insert"],
    ["friend_requests", "insert"],
    ["meetup_requests", "insert"]
  ])("keeps %s.%s closed to browser roles", (table, op) => {
    // Server-managed surfaces: writes go through trusted routes, not clients.
    const granted = parseGrants(grantSql).some(
      (s) =>
        s.table === table &&
        s.ops.includes(op) &&
        (s.roles.includes("authenticated") || s.roles.includes("anon"))
    );
    expect(granted).toBe(false);
  });
});

describe("anon authority does not widen", () => {
  it("grants anon no table privileges at all", () => {
    // A generic auth.uid() policy applies to PUBLIC but was written for
    // signed-in callers. Treating it as anon evidence would hand signed-out
    // visitors read access across the app.
    const anonTableGrants = parseGrants(grantSql).filter((s) => s.roles.includes("anon"));
    expect(anonTableGrants).toEqual([]);
  });
});

describe("no browser default privileges", () => {
  it("does not add ALTER DEFAULT PRIVILEGES for anon or authenticated", () => {
    // Default privileges for browser roles would silently grant access to
    // every FUTURE table before its security contract has been reviewed.
    for (const statement of grantSql.match(/alter\s+default\s+privileges[\s\S]*?;/g) ?? []) {
      expect(statement).not.toMatch(/\banon\b/);
      expect(statement).not.toMatch(/\bauthenticated\b/);
    }
  });

  it("leaves the service-role repair intact", () => {
    const serviceRepair = files.find((n) => n.includes("service_role_grant_reproducibility"));
    expect(serviceRepair).toBeDefined();
    const sql = sqlOf(readFileSync(path.join(MIGRATIONS, serviceRepair!), "utf8")).toLowerCase();
    expect(sql).toMatch(/alter\s+default\s+privileges\s+for\s+role\s+postgres/);
    expect(sql).toMatch(/on\s+all\s+tables\s+in\s+schema\s+public\s+to\s+service_role/);
  });
});

describe("no migration grants broadly to a browser role", () => {
  it("keeps the local-only blanket grant script out of migration history", () => {
    for (const { name, sql } of bySource) {
      for (const statement of sql.toLowerCase().match(
        /grant\s+[^;]*\bon\s+all\s+tables\s+in\s+schema\s+public\s+to\s+[^;]*;/g
      ) ?? []) {
        expect(statement, `${name} grants broadly to anon`).not.toMatch(/\banon\b/);
        expect(statement, `${name} grants broadly to authenticated`).not.toMatch(/\bauthenticated\b/);
      }
    }
  });
});
