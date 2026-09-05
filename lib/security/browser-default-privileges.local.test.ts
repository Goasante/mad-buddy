import { execFileSync } from "node:child_process";

import { beforeAll, describe, expect, it } from "vitest";

/**
 * Default privileges, measured rather than inferred from migration text.
 *
 * TABLES/SEQUENCES are normalized per-schema. FUNCTIONS require a GLOBAL
 * default-privilege revoke because PostgreSQL's built-in EXECUTE-to-PUBLIC
 * default is global; a schema-local revoke cannot subtract it.
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
  it("grants anon no DML", () => {
    const out = probe(`
      select has_table_privilege('anon','public._adp_probe_t','SELECT')::text || ',' ||
             has_table_privilege('anon','public._adp_probe_t','INSERT')::text || ',' ||
             has_table_privilege('anon','public._adp_probe_t','UPDATE')::text || ',' ||
             has_table_privilege('anon','public._adp_probe_t','DELETE')::text;
    `);
    expect(out).toBe("false,false,false,false");
  });

  it("grants authenticated no DML", () => {
    const out = probe(`
      select has_table_privilege('authenticated','public._adp_probe_t','SELECT')::text || ',' ||
             has_table_privilege('authenticated','public._adp_probe_t','INSERT')::text || ',' ||
             has_table_privilege('authenticated','public._adp_probe_t','UPDATE')::text || ',' ||
             has_table_privilege('authenticated','public._adp_probe_t','DELETE')::text;
    `);
    expect(out).toBe("false,false,false,false");
  });

  it("keeps service_role fully able to use it", () => {
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
  it("denies anon/authenticated USAGE and keeps service_role", () => {
    const out = probe(`
      select has_sequence_privilege('anon','public._adp_probe_s','USAGE')::text || ',' ||
             has_sequence_privilege('authenticated','public._adp_probe_s','USAGE')::text || ',' ||
             has_sequence_privilege('service_role','public._adp_probe_s','USAGE')::text;
    `);
    expect(out).toBe("false,false,true");
  });

  it("covers the implicit sequence behind bigserial", () => {
    const out = probe(`
      select has_sequence_privilege('authenticated','public._adp_probe_t_id_seq','USAGE')::text || ',' ||
             has_sequence_privilege('service_role','public._adp_probe_t_id_seq','USAGE')::text;
    `);
    expect(out).toBe("false,true");
  });
});

describe("a future FUNCTION is server-only by default", () => {
  it("removes PostgreSQL's built-in PUBLIC EXECUTE", () => {
    const out = probe(`
      select has_function_privilege('public','public._adp_probe_f()','EXECUTE')::text || ',' ||
             has_function_privilege('anon','public._adp_probe_f()','EXECUTE')::text || ',' ||
             has_function_privilege('authenticated','public._adp_probe_f()','EXECUTE')::text || ',' ||
             has_function_privilege('service_role','public._adp_probe_f()','EXECUTE')::text;
    `);
    expect(out).toBe("false,false,false,true");
  });

  it("stores the PUBLIC revoke in the GLOBAL postgres function default ACL", () => {
    const out = psql(`
      select coalesce(array_to_string(defaclacl, ' '), '(empty)')
      from pg_default_acl
      where defaclrole = 'postgres'::regrole
        and defaclnamespace = 0
        and defaclobjtype = 'f'
    `);
    expect(out).not.toMatch(/(^|\s)=X\//);
    expect(out).not.toMatch(/\banon=/);
    expect(out).not.toMatch(/\bauthenticated=/);
    expect(out).toMatch(/\bservice_role=X\//);
  });

  it("leaves no mutating shipped function reachable by anon/PUBLIC", () => {
    const out = psql(`
      select coalesce(string_agg(p.proname, ', '), 'NONE')
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.prokind = 'f' and p.provolatile = 'v'
        and pg_get_function_result(p.oid) <> 'trigger'
        and (has_function_privilege('anon', p.oid, 'EXECUTE')
             or has_function_privilege('public', p.oid, 'EXECUTE'))
    `);
    expect(out).toBe("NONE");
  });
});
