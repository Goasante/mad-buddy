import { execFileSync } from "node:child_process";

import { beforeAll, describe, expect, it } from "vitest";

/**
 * SEC-002, asserted against a real database.
 *
 * lib/security/plan-participant-authority.test.ts proves the migration was
 * written correctly. This proves it took effect -- the distinction that let the
 * profiles defect ship, where correct migrations sat over a database that
 * disagreed with them.
 *
 * It also pins the property that makes SEC-002 durable rather than merely
 * fixed. The migration does two things:
 *
 *   1. revokes browser DML  -> the GRANT layer denies the write
 *   2. drops the own-row UPDATE policy -> RLS denies it as well
 *
 * Either alone would close today's hole. Both together mean a future accidental
 * broad table grant -- exactly what the hosted platform default does to every
 * new table -- cannot reactivate self-promotion on its own. The second test
 * below restores that grant inside a transaction and shows RLS still refuses,
 * then rolls back.
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
    // A local suite that cannot reach its database must fail, never skip.
    throw new Error(
      `database read failed against container "${DB_CONTAINER}". ` +
        `Set AUDIT_DB_CONTAINER if this stack uses another name. ` +
        String((error as Error).message).slice(0, 200)
    );
  }
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

describe("browser roles hold no DML on plan_participants", () => {
  it.each(["anon", "authenticated"])("grants %s no INSERT, UPDATE or DELETE", (role) => {
    const out = psql(`
      select coalesce(string_agg(privilege_type, ',' order by privilege_type), 'NONE')
      from information_schema.role_table_grants
      where table_schema = 'public' and table_name = 'plan_participants'
        and grantee = '${role}' and privilege_type in ('INSERT','UPDATE','DELETE')
    `);
    expect(out).toBe("NONE");
  });

  it.each(["anon", "authenticated"])("grants %s no column-level write either", (role) => {
    // A table-level revoke leaves column grants standing, so they are checked
    // separately -- that gap is what kept D4's column INSERT alive on profiles.
    const out = psql(`
      select coalesce(string_agg(distinct column_name, ',' order by column_name), 'NONE')
      from information_schema.column_privileges
      where table_schema = 'public' and table_name = 'plan_participants'
        and grantee = '${role}' and privilege_type in ('INSERT','UPDATE')
    `);
    expect(out).toBe("NONE");
  });

  it("keeps service_role as the canonical mutation authority", () => {
    const out = psql(`
      select coalesce(string_agg(privilege_type, ',' order by privilege_type), 'NONE')
      from information_schema.role_table_grants
      where table_schema = 'public' and table_name = 'plan_participants'
        and grantee = 'service_role' and privilege_type in ('SELECT','INSERT','UPDATE','DELETE')
    `);
    expect(out).toBe("DELETE,INSERT,SELECT,UPDATE");
  });

  it("keeps RLS enabled", () => {
    const out = psql(`
      select c.relrowsecurity::text from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = 'plan_participants'
    `);
    expect(out).toBe("true");
  });

  it("no longer carries a browser write policy", () => {
    // "participants update own rsvp" pinned only user_id, leaving `role`
    // writable -- host and co_host confer real plan authority.
    const out = psql(`
      select coalesce(string_agg(policyname || '(' || cmd || ')', ', ' order by policyname), 'NONE')
      from pg_policies
      where schemaname = 'public' and tablename = 'plan_participants' and cmd in ('ALL','UPDATE','INSERT','DELETE')
    `);
    expect(out).toBe("NONE");
  });
});

describe("a future accidental table grant cannot recreate SEC-002", () => {
  it("still denies self-promotion when browser DML is restored", () => {
    /* The hosted platform default grants arwdDxtm on every new table, so this
       is not a hypothetical: it is the exact condition production was in. With
       the policy gone, RLS matches no row and the UPDATE writes nothing.
       Everything runs in a transaction and is rolled back. */
    const out = psql(`
      begin;
      grant select, insert, update, delete on table public.plan_participants to authenticated;
      do $$
      declare
        v_host uuid := '4a000000-0000-4000-8000-00000000004a';
        v_part uuid := '4b000000-0000-4000-8000-00000000004b';
        v_plan uuid;
        v_rows integer;
        v_role text;
      begin
        insert into public.plans (creator_id, title, plan_type, visibility_type, status,
                                  timezone, max_participants, place_type, start_at)
        values (v_host, 'SEC-002 rls proof', 'scheduled', 'invited', 'inviting',
                'UTC', 10, 'decide_in_chat', now() + interval '1 day')
        returning id into v_plan;

        insert into public.plan_participants (plan_id, user_id, role, rsvp_status)
        values (v_plan, v_host, 'host', 'going'), (v_plan, v_part, 'participant', 'invited');

        set local role authenticated;
        perform set_config('request.jwt.claims',
          json_build_object('sub', v_part, 'role', 'authenticated')::text, true);

        update public.plan_participants set role = 'co_host'
         where plan_id = v_plan and user_id = v_part;
        get diagnostics v_rows = ROW_COUNT;

        reset role;
        select role into v_role from public.plan_participants
         where plan_id = v_plan and user_id = v_part;

        -- Returned as a row, not a NOTICE: psql sends notices to stderr, which
        -- this helper does not capture.
        create temp table sec002_result as select v_rows as rows_written, v_role as final_role;
      end $$;
      select 'ROWS=' || rows_written::text || ' ROLE=' || final_role from sec002_result;
      rollback;
    `);
    expect(out).toContain("ROWS=0");
    expect(out).toContain("ROLE=participant");
  });

  it("leaves no grant behind after that transaction", () => {
    const out = psql(`
      select coalesce(string_agg(privilege_type, ','), 'NONE')
      from information_schema.role_table_grants
      where table_schema = 'public' and table_name = 'plan_participants'
        and grantee = 'authenticated' and privilege_type in ('INSERT','UPDATE','DELETE')
    `);
    expect(out).toBe("NONE");
  });
});
