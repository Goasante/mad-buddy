import { execFileSync } from "node:child_process";

import { beforeAll, describe, expect, it } from "vitest";

/**
 * SEC-001, asserted against a real database.
 *
 * The source-text suite (safe-arrival-rpc-execute-authority.test.ts) proves the
 * migration was WRITTEN to cover the whole overload family. Only a database can
 * prove it TOOK EFFECT -- and the profiles defect earlier in this release
 * demonstrated the gap between those two claims: correct migrations, and a
 * database that still disagreed with them.
 *
 * This suite enumerates every function named public.transition_safe_arrival
 * from the catalog and asserts the effective privilege of each:
 *
 *   PUBLIC         EXECUTE = NO
 *   anon           EXECUTE = NO
 *   authenticated  EXECUTE = NO
 *   service_role   EXECUTE = YES
 *
 * Because it enumerates rather than naming signatures, a future overload that
 * is born with the default EXECUTE TO PUBLIC fails this suite automatically --
 * which is the specific regression SEC-001 was.
 */

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const DB_CONTAINER = process.env.AUDIT_DB_CONTAINER ?? "supabase_db_mad-buddy";

type Row = {
  sig: string;
  public_exec: boolean;
  anon_exec: boolean;
  auth_exec: boolean;
  service_exec: boolean;
  secdef: boolean;
};

function sql<T>(query: string): T[] {
  const wrapped = `select coalesce(json_agg(t), '[]'::json) from (${query}) t`;
  let out: string;
  try {
    out = execFileSync(
      "docker",
      ["exec", "-i", DB_CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-tA", "-c", wrapped],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
    );
  } catch (error) {
    // A local suite that cannot reach its database must fail, never skip: a
    // silent skip reads exactly like passing coverage that does not exist.
    throw new Error(
      `catalog read failed against container "${DB_CONTAINER}". ` +
        `Set AUDIT_DB_CONTAINER if this stack uses another name. ` +
        String((error as Error).message).slice(0, 200)
    );
  }
  return JSON.parse(out.trim() || "[]") as T[];
}

let overloads: Row[] = [];

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

  overloads = sql<Row>(`
    select
      p.oid::regprocedure::text                                as sig,
      has_function_privilege('public', p.oid, 'EXECUTE')        as public_exec,
      has_function_privilege('anon', p.oid, 'EXECUTE')          as anon_exec,
      has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth_exec,
      has_function_privilege('service_role', p.oid, 'EXECUTE')  as service_exec,
      p.prosecdef                                               as secdef
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'transition_safe_arrival'
      and p.prokind = 'f'
  `);
});

describe("every transition_safe_arrival overload is server-only", () => {
  it("finds at least the two known overloads", () => {
    // Guards against the suite passing vacuously if the query stops matching.
    expect(overloads.length).toBeGreaterThanOrEqual(2);
  });

  it("grants PUBLIC no EXECUTE on any overload", () => {
    const bad = overloads.filter((o) => o.public_exec).map((o) => o.sig);
    expect(bad, "an unauthenticated caller could reach these").toEqual([]);
  });

  it("grants anon no EXECUTE on any overload", () => {
    expect(overloads.filter((o) => o.anon_exec).map((o) => o.sig)).toEqual([]);
  });

  it("grants authenticated no EXECUTE on any overload", () => {
    /* The function trusts p_actor_id, so a signed-in person with EXECUTE could
       act as anyone -- not only as themselves. */
    expect(overloads.filter((o) => o.auth_exec).map((o) => o.sig)).toEqual([]);
  });

  it("keeps EXECUTE for service_role on every overload", () => {
    // The server's own path. REVOKE ALL FROM PUBLIC strips this too if the
    // grant is not restated, and that has taken the app down before.
    const missing = overloads.filter((o) => !o.service_exec).map((o) => o.sig);
    expect(missing, "the server would 42501 on Safe Arrival transitions").toEqual([]);
  });

  it("keeps every overload SECURITY DEFINER", () => {
    // If one were INVOKER, service_role's own RLS bypass would be doing the
    // work and the authority model would be different from the one reviewed.
    expect(overloads.filter((o) => !o.secdef).map((o) => o.sig)).toEqual([]);
  });
});
