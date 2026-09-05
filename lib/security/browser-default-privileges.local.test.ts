import { execFileSync } from "node:child_process";

import { beforeAll, describe, expect, it } from "vitest";

/**
 * Default privileges, measured rather than read.
 *
 * browser-default-privileges.test.ts asserts the migration's SQL text. This
 * creates real future objects and reads the ACL they are born with, which is
 * the only way to know what the default actually does -- and here the two
 * answers differ in a way that matters.
 *
 * TABLES and SEQUENCES: the normalization works. A new table or sequence gives
 * anon and authenticated nothing, and service_role everything it needs.
 *
 * FUNCTIONS: it does NOT work, and cannot. Measured on PostgreSQL 17.6, a new
 * function is born with proacl NULL and PostgreSQL applies its BUILT-IN default
 * of EXECUTE TO PUBLIC. That built-in grant sits underneath pg_default_acl:
 * driving the default ACL to `postgres=X service_role=X` (PUBLIC absent) still
 * produces `=X/postgres ...` on the next CREATE FUNCTION. No ALTER DEFAULT
 * PRIVILEGES form suppresses it.
 *
 * That is exactly the SEC-001 mechanism, so this suite pins the limitation
 * instead of pretending it is closed. The durable control is the contract in
 * schema-authority-contract.local.test.ts, which fails the build if any VOLATILE
 * non-trigger function in `public` is reachable by anon or PUBLIC -- meaning a
 * new mutating RPC must carry its own explicit REVOKE.
 */

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const DB_CONTAINER = process.env.AUDIT_DB_CONTAINER ?? "supabase_db_mad-buddy";

function psql(sql: string): string {
  try {
    return execFileSync(
      "docker",
      ["exec", "-i", DB_CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-tA", "-c", sql],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
    ).trim();
  } catch (error) {
    throw new Error(
      `database read failed against container "${DB_CONTAINER}". ` +
        `Set AUDIT_DB_CONTAINER if this stack uses another name. ` +
        String((error as Error).message).slice(0, 200)
    );
  }
}

/**
 * Create disposable future objects, read their birth ACL, roll back.
 *
 * psql echoes a command tag per statement (BEGIN, CREATE TABLE, ROLLBACK...),
 * so the result row is picked out rather than taking the whole output.
 */
function probe(select: string): string {
  const raw = psql(`
    begin;
    create table public._adp_probe_t (id bigserial primary key, note text);
    create sequence public._adp_probe_s;
    create function public._adp_probe_f() returns integer language sql immutable as 'select 1';
    ${select}
    rollback;
  `);
  const TAGS = /^(BEGIN|COMMIT|ROLLBACK|CREATE .*|DROP .*|ALTER .*|SET|REVOKE|GRANT|DO)$/;
  const rows = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !TAGS.test(l));
  return rows[rows.length - 1] ?? "";
}

beforeAll(() => {
  let host = "";
  try {
    host = new URL(url).host;
  } catch {
    host = "";
  }
  if (!/^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(host)) {
    throw new Error(`refusing to touch a non-local database (host: ${host || "unset"})`);
  }
});

describe("a future TABLE gives browser roles nothing", () => {
  it("grants anon no privilege at all", () => {
    const out = probe(`
      select has_table_privilege('anon','public._adp_probe_t','SELECT')::text || ',' ||
             has_table_privilege('anon','public._adp_probe_t','INSERT')::text || ',' ||
             has_table_privilege('anon','public._adp_probe_t','UPDATE')::text || ',' ||
             has_table_privilege('anon','public._adp_probe_t','DELETE')::text;
    `);
    expect(out).toBe("false,false,false,false");
  });

  it("grants authenticated no privilege at all", () => {
    const out = probe(`
      select has_table_privilege('authenticated','public._adp_probe_t','SELECT')::text || ',' ||
             has_table_privilege('authenticated','public._adp_probe_t','INSERT')::text || ',' ||
             has_table_privilege('authenticated','public._adp_probe_t','UPDATE')::text || ',' ||
             has_table_privilege('authenticated','public._adp_probe_t','DELETE')::text;
    `);
    expect(out).toBe("false,false,false,false");
  });

  it("keeps service_role fully able to use it", () => {
    // 20260903120000 owns this; a fresh database was once app-wide 42501
    // because service_role had no authority on new tables.
    const out = probe(`
      select has_table_privilege('service_role','public._adp_probe_t','SELECT')::text || ',' ||
             has_table_privilege('service_role','public._adp_probe_t','INSERT')::text || ',' ||
             has_table_privilege('service_role','public._adp_probe_t','UPDATE')::text || ',' ||
             has_table_privilege('service_role','public._adp_probe_t','DELETE')::text;
    `);
    expect(out).toBe("true,true,true,true");
  });
});

describe("a future SEQUENCE gives browser roles nothing", () => {
  it("denies anon and authenticated USAGE, keeps service_role", () => {
    const out = probe(`
      select has_sequence_privilege('anon','public._adp_probe_s','USAGE')::text || ',' ||
             has_sequence_privilege('authenticated','public._adp_probe_s','USAGE')::text || ',' ||
             has_sequence_privilege('service_role','public._adp_probe_s','USAGE')::text;
    `);
    expect(out).toBe("false,false,true");
  });

  it("covers the implicit sequence behind a bigserial column too", () => {
    // An identity/serial column creates its own sequence; it inherits the same
    // default, and a browser INSERT into such a table needs USAGE on it.
    const out = probe(`
      select has_sequence_privilege('authenticated','public._adp_probe_t_id_seq','USAGE')::text || ',' ||
             has_sequence_privilege('service_role','public._adp_probe_t_id_seq','USAGE')::text;
    `);
    expect(out).toBe("false,true");
  });
});

describe("a future FUNCTION is still PUBLIC-executable -- a database limitation, not a gap in the migration", () => {
  it("is born publicly executable despite the default-privilege revoke", () => {
    /* Deliberately asserts the UNDESIRED value. If a future PostgreSQL version
       (or a Supabase platform change) makes ALTER DEFAULT PRIVILEGES able to
       suppress the built-in PUBLIC EXECUTE, this test fails -- and that failure
       is good news: delete this case, flip the expectation, and the SEC-001
       class is closed at the default layer. Until then it documents why the
       contract test below is load-bearing. */
    const out = probe(`
      select has_function_privilege('public','public._adp_probe_f()','EXECUTE')::text;
    `);
    expect(out).toBe("true");
  });

  it("has PUBLIC removed from the default ACL even so", () => {
    // The migration's revoke is not useless: it keeps anon and authenticated
    // out of the default ACL itself. It just cannot beat the built-in grant.
    const out = psql(`
      select coalesce(array_to_string(defaclacl, ' '), '(empty)')
      from pg_default_acl
      where defaclrole = 'postgres'::regrole
        and defaclnamespace = 'public'::regnamespace
        and defaclobjtype = 'f'
    `);
    expect(out).not.toMatch(/(^|\s)=X\//); // no PUBLIC entry
    expect(out).not.toMatch(/\banon=/);
    expect(out).not.toMatch(/\bauthenticated=/);
  });

  it("leaves no mutating function reachable by anon in the shipped schema", () => {
    // The control that actually holds the SEC-001 line. Trigger functions are
    // excluded: PostgREST cannot invoke a function returning `trigger`.
    const out = psql(`
      select coalesce(string_agg(p.proname, ', '), 'NONE')
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.prokind = 'f' and p.provolatile = 'v'
        and pg_get_function_result(p.oid) <> 'trigger'
        and (p.proacl is null
             or exists (select 1 from unnest(p.proacl) a
                        where a::text like '=X/%' or a::text like 'anon=%'))
    `);
    expect(out).toBe("NONE");
  });
});
