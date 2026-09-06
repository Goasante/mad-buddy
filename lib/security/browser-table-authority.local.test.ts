import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

/**
 * Effective browser authority across all 191 public tables.
 *
 * The allowlist is not restated here: it is read from
 * docs/security/browser-authority-audit.json, the artifact the audit produced.
 * One source of truth, so adding a table to the allowlist is a visible edit to
 * a reviewed document rather than a quiet change to a test fixture.
 *
 * Grants are asserted as the CATALOG reports them, not as migration text says
 * they should be. That distinction is the whole reason this tranche exists: the
 * profiles defect shipped with correct migrations over a hosted database that
 * disagreed with them.
 */

const ROOT = process.cwd();
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const DB_CONTAINER = process.env.AUDIT_DB_CONTAINER ?? "supabase_db_mad-buddy";

type Audit = {
  A_browser_write_allowlist: Record<string, { granted?: Record<string, unknown> }>;
};

const audit = JSON.parse(
  readFileSync(path.join(ROOT, "docs", "security", "browser-authority-audit.json"), "utf8")
) as Audit;

const ALLOWLIST = Object.keys(audit.A_browser_write_allowlist).sort();

function sql<T>(query: string): T[] {
  const wrapped = `select coalesce(json_agg(t), '[]'::json) from (${query}) t`;
  try {
    const out = execFileSync(
      "docker",
      ["exec", "-i", DB_CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-tA", "-c", wrapped],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
    );
    return JSON.parse(out.trim() || "[]") as T[];
  } catch (error) {
    // Fail, never skip: a silent skip reads exactly like passing coverage.
    throw new Error(
      `catalog read failed against container "${DB_CONTAINER}". ` +
        `Set AUDIT_DB_CONTAINER if this stack uses another name. ` +
        String((error as Error).message).slice(0, 200)
    );
  }
}

type Grant = { table_name: string; grantee: string; privilege_type: string };
let grants: Grant[] = [];

beforeAll(() => {
  let host = "";
  try {
    host = new URL(url).host;
  } catch {
    host = "";
  }
  if (!/^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(host)) {
    throw new Error(`refusing to read a non-local database (host: ${host || "unset"})`);
  }
  grants = sql<Grant>(`
    select table_name, grantee, privilege_type
    from information_schema.role_table_grants
    where table_schema = 'public' and grantee in ('anon','authenticated','service_role','PUBLIC')
  `);
});

const of = (grantee: string, privs: string[]) =>
  grants.filter((g) => g.grantee === grantee && privs.includes(g.privilege_type));

describe("anon holds no write or DDL-adjacent authority anywhere", () => {
  it("has no INSERT, UPDATE or DELETE on any public table", () => {
    const bad = of("anon", ["INSERT", "UPDATE", "DELETE"])
      .map((g) => `${g.table_name}:${g.privilege_type}`)
      .sort();
    expect(bad).toEqual([]);
  });

  it("has no TRUNCATE, REFERENCES or TRIGGER either", () => {
    // These came from the platform default ACL and no browser path uses them.
    const bad = of("anon", ["TRUNCATE", "REFERENCES", "TRIGGER"])
      .map((g) => `${g.table_name}:${g.privilege_type}`)
      .sort();
    expect(bad).toEqual([]);
  });

  it("has no column-level write anywhere", () => {
    const bad = sql<{ t: string }>(`
      select table_name || '.' || column_name || ':' || privilege_type as t
      from information_schema.column_privileges
      where table_schema = 'public' and grantee = 'anon'
        and privilege_type in ('INSERT','UPDATE')
    `);
    expect(bad.map((r) => r.t).sort()).toEqual([]);
  });
});

describe("authenticated writes only the audited allowlist", () => {
  it("holds no write outside docs/security/browser-authority-audit.json", () => {
    const granted = [...new Set(of("authenticated", ["INSERT", "UPDATE", "DELETE"]).map((g) => g.table_name))];
    const unexpected = granted.filter((t) => !ALLOWLIST.includes(t)).sort();
    expect(
      unexpected,
      "a signed-in person could write these directly through PostgREST with no product path using them"
    ).toEqual([]);
  });

  it("has no TRUNCATE, REFERENCES or TRIGGER on any table", () => {
    const bad = of("authenticated", ["TRUNCATE", "REFERENCES", "TRIGGER"])
      .map((g) => `${g.table_name}:${g.privilege_type}`)
      .sort();
    expect(bad).toEqual([]);
  });

  it("keeps profiles column-scoped -- it carries staff-controlled columns", () => {
    /* RLS scopes rows, not columns. A table-wide UPDATE under an owner policy
       hands over every column -- that was SEC-002 and the profiles defect.
       `profiles` is the case where that matters most (trusted_member_since,
       is_onboarded, deleted_at), and its write is a plain UPDATE, so column
       scoping works.

       The four upsert tables cannot be column-scoped: PostgREST checks the
       TABLE privilege before resolving columns, so `.upsert()` fails 403 42501
       with a column-only UPDATE grant even when every written column is
       granted. Measured against a real PostgREST, not assumed. They are safe
       column-wise anyway -- every column on them is user-owned, and the
       "staff- and server-controlled columns" case below is what enforces that. */
    const tableWide = of("authenticated", ["UPDATE"]).map((g) => g.table_name);
    expect(tableWide).not.toContain("profiles");
  });

  it("limits table-wide UPDATE to the upsert paths that require it", () => {
    const UPSERT_TABLES = ["profile_field_privacy", "user_preferences", "push_subscriptions", "blocked_users", "best_buddies"];
    const tableWide = [...new Set(of("authenticated", ["UPDATE"]).map((g) => g.table_name))];
    const unexpected = tableWide.filter((t) => !UPSERT_TABLES.includes(t)).sort();
    expect(unexpected, "table-wide UPDATE is only justified by PostgREST upsert semantics").toEqual([]);
  });

  it("keeps staff- and server-controlled columns unwritable", () => {
    /* Only tables whose columns actually differ in authority are listed.
       user_preferences is deliberately absent: every one of its columns is the
       owner's own preference data, there is no staff or moderation field on it,
       and updated_at is maintained by a trigger. Listing audit timestamps there
       would fail for a table that carries no escalation risk, and a test that
       cries wolf gets relaxed rather than heeded. */
    const protectedCols: Record<string, string[]> = {
      profiles: ["trusted_member_since", "is_onboarded", "deleted_at", "created_at", "user_id", "avatar_url"],
      reports: ["status", "reported_user_label", "id", "created_at", "updated_at"],
      support_tickets: ["assigned_to", "resolved_at", "id", "created_at"],
    };
    const rows = sql<{ table_name: string; column_name: string; privilege_type: string }>(`
      select table_name, column_name, privilege_type
      from information_schema.column_privileges
      where table_schema = 'public' and grantee = 'authenticated'
        and privilege_type in ('INSERT','UPDATE')
    `);
    const bad: string[] = [];
    for (const r of rows) {
      if (protectedCols[r.table_name]?.includes(r.column_name)) {
        bad.push(`${r.table_name}.${r.column_name}:${r.privilege_type}`);
      }
    }
    expect(bad.sort()).toEqual([]);
  });
});

describe("the server keeps its authority", () => {
  it("gives service_role full DML on every public table", () => {
    const missing = sql<{ t: string }>(`
      select c.relname as t
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r'
        and not (has_table_privilege('service_role', c.oid, 'SELECT')
             and has_table_privilege('service_role', c.oid, 'INSERT')
             and has_table_privilege('service_role', c.oid, 'UPDATE')
             and has_table_privilege('service_role', c.oid, 'DELETE'))
    `);
    // A fresh database has been app-wide 42501 before for exactly this reason.
    expect(missing.map((r) => r.t).sort()).toEqual([]);
  });
});

describe("row security is on everywhere", () => {
  it("enables RLS on all public tables", () => {
    const off = sql<{ t: string }>(`
      select c.relname as t from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
    `);
    expect(off.map((r) => r.t).sort()).toEqual([]);
  });

  it("leaves no allowlisted table without a policy", () => {
    // A write grant with no policy is authority waiting for the first policy
    // someone adds.
    const policied = sql<{ tablename: string }>(
      `select distinct tablename from pg_policies where schemaname = 'public'`
    ).map((p) => p.tablename);
    const missing = ALLOWLIST.filter((t) => !policied.includes(t));
    expect(missing).toEqual([]);
  });
});

describe("upsert paths keep the SELECT they need", () => {
  it.each(["profile_field_privacy", "push_subscriptions", "user_preferences", "blocked_users", "best_buddies", "reports"])(
    "grants authenticated SELECT on %s",
    (table) => {
      /* PostgREST must read the conflict target to resolve ON CONFLICT.
         Without this, .upsert() fails 42501 -- the D4 failure mode. */
      const has = grants.some(
        (g) => g.table_name === table && g.grantee === "authenticated" && g.privilege_type === "SELECT"
      );
      expect(has).toBe(true);
    }
  );
});
