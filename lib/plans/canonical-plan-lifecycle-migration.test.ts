import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20260814200000_canonical_plan_lifecycle.sql"
  ),
  "utf8"
)
  /* Normalised BEFORE anything indexes into it.
   *
   * Git checks this file out with CRLF on Windows, so assertions written with
   * a literal \n failed on a clean clone while passing wherever the file
   * happened to have LF endings. Normalising after an indexOf would shift
   * every offset that had already been taken. */
  .replace(/\r\n/g, "\n")
  .toLowerCase();

describe("canonical Plan lifecycle migration", () => {
  it("makes both UpFor conversion links unique and preserves Plan history", () => {
    expect(sql).toContain("create unique index if not exists plans_source_hangout_unique");
    expect(sql).toContain(
      "create unique index if not exists hangout_sessions_converted_plan_unique"
    );
    expect(sql).toContain("constraint plans_source_hangout_fk");
    expect(sql).toContain("references public.hangout_sessions(id)");
    expect(sql).toContain("on delete set null");
  });

  it("keeps Plan, participants, chat, conversion marker, and jobs in one function", () => {
    const lifecycle = sql.slice(
      sql.indexOf("create or replace function public.create_plan_lifecycle"),
      sql.indexOf("create or replace function public.set_plan_participant_rsvp")
    );

    expect(lifecycle).toContain("insert into public.plans");
    expect(lifecycle).toContain("insert into public.plan_participants");
    expect(lifecycle).toContain("public.reconcile_plan_conversation_members(v_plan_id)");
    expect(lifecycle).toContain("set status = 'converted_to_plan'");
    expect(lifecycle).toContain("converted_plan_id = v_plan_id");
    expect(lifecycle).toContain("insert into public.jobs");
    expect(lifecycle).toContain("insert into public.idempotency_keys");
  });

  it("serialises source conversion, stable request retries, and active limits", () => {
    expect(sql).toContain("where hs.id = p_source_hangout_id\n    for update");
    expect(sql).toContain("'plans:actor:' || p_actor_id::text");
    expect(sql).toContain("'plans:create:' || p_actor_id::text || ':' || p_request_key");
    expect(sql).toContain("ik.scope = 'plans.create'");
    expect(sql).toContain("PLAN_ACTIVE_LIMIT_REACHED".toLowerCase());
    expect(sql).toContain("return query select v_plan_id, v_conversation_id, false");
  });

  it("maps only accepted UpFor requests to Going", () => {
    expect(sql).toContain("hr.status = 'accepted'");
    expect(sql).toContain("v_initial_going_ids := v_candidate_ids");
    expect(sql).not.toMatch(/hr\.status\s+in\s*\([^)]*pending/);
    expect(sql).not.toMatch(/hr\.status\s+in\s*\([^)]*maybe/);
  });

  it("joins only host, Going, and Maybe members", () => {
    const reconcile = sql.slice(
      sql.indexOf("create or replace function public.reconcile_plan_conversation_members"),
      sql.indexOf("create or replace function public.create_plan_lifecycle")
    );

    expect(reconcile).toContain("pp.rsvp_status in ('going', 'maybe')");
    expect(reconcile).toContain("set status = 'left'");
    expect(reconcile).not.toMatch(/pp\.rsvp_status\s+in\s*\([^)]*invited/);
    expect(reconcile).not.toMatch(/pp\.rsvp_status\s+in\s*\([^)]*waitlisted/);
  });

  it("updates RSVP and Plan Chat membership atomically", () => {
    const rsvp = sql.slice(
      sql.indexOf("create or replace function public.set_plan_participant_rsvp"),
      sql.indexOf("create or replace function public.add_plan_participants")
    );

    expect(rsvp).toContain("update public.plan_participants");
    expect(rsvp).toContain("public.reconcile_plan_conversation_members(p_plan_id)");
    expect(rsvp).toContain("PLAN_PARTICIPANT_INELIGIBLE".toLowerCase());
  });

  it("reuses a removed participant row without duplicating active invitations", () => {
    const add = sql.slice(
      sql.indexOf("create or replace function public.add_plan_participants"),
      sql.indexOf("revoke all on function public.reconcile_plan_conversation_members")
    );

    expect(add).toContain("on conflict (plan_id, user_id) do update");
    expect(add).toContain("where public.plan_participants.rsvp_status = 'removed'");
    expect(add).toContain("returning user_id");
  });

  it("deduplicates invitation work at the existing jobs boundary", () => {
    expect(sql).toContain(
      "'plan-invite:' || v_plan_id::text || ':' || v_recipient_id::text"
    );
    expect(sql).toContain(
      "'plan-invite:' || p_plan_id::text || ':' || v_recipient_id::text"
    );
    expect(sql).toContain("on conflict (idempotency_key)");
    expect(sql).not.toContain("notifications.dedupe_key");
    expect(sql).not.toContain("notifications_user_dedupe_unique");
    expect(sql).not.toMatch(/alter\s+table\s+public\.notifications/);
  });

  it("keeps every lifecycle function server-only", () => {
    for (const signature of [
      "public.reconcile_plan_conversation_members(uuid)",
      "public.set_plan_participant_rsvp(uuid, uuid, text)",
      "public.add_plan_participants(uuid, uuid, uuid[], integer)"
    ]) {
      expect(sql).toContain(`revoke all on function ${signature}`);
      expect(sql).toContain(`grant execute on function ${signature}`);
    }
    expect(sql).toContain("from public, anon, authenticated");
    expect(sql).toContain("to service_role");
    expect(sql).not.toContain("security definer");
  });

  it("gives the invoker only the table operations needed by the lifecycle", () => {
    expect(sql).toContain("grant select on table");
    expect(sql).toContain("grant insert on table");
    expect(sql).toContain("grant update on table");
    expect(sql).not.toMatch(/grant\s+(all|delete)\s+on\s+table/);
    expect(sql).not.toMatch(/to\s+(public|anon|authenticated)\s*;/);
  });

  it("contains no destructive or unrelated schema changes", () => {
    expect(sql).not.toMatch(/\bdrop\s+(table|column|schema)\b/);
    expect(sql).not.toMatch(/\btruncate\b/);
    expect(sql).not.toMatch(/\bdelete\s+from\b/);
    expect(sql).not.toMatch(/\balter\s+table\s+public\.notifications\b/);
  });
});
