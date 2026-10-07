import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function read(name: string) {
  return fs.readFileSync(path.join(process.cwd(), "supabase", "migrations", name), "utf8");
}

describe("Meet New People database boundary", () => {
  const edits = read("20261007211756_meetup_discovery_creator_edits.sql");
  it("restricts edits to active listings owned by the authenticated creator", () => {
    expect(edits).toContain("p_actor_id<>v_d.creator_id");
    expect(edits).toContain("v_d.listing_expires_at<=now()");
    expect(edits).toContain("security invoker set search_path=''");
    expect(edits).toContain("from public,anon,authenticated");
    expect(edits).toContain("to service_role");
  });
  it("preserves expiry and uses the canonical linked Meetup reschedule flow", () => {
    expect(edits).toContain("public.meetup_command_server(p_actor_id,'reschedule'");
    expect(edits).toContain("update public.group_settings g set name=v_title");
    expect(edits).not.toContain("listing_expires_at=");
    expect(edits).not.toContain("max_attendees=");
  });
  const lifecycle = read("20261007141400_meet_new_people_discovery.sql");
  const projection = read("20261007142230_meet_new_people_projection_hardening.sql");
  const refreshProjection = read("20261007144246_meet_new_people_refresh_projection.sql");

  it("enforces the shared owner limit and fixed response pool server-side", () => {
    expect(lifecycle).toContain("public.meetup_owner_active_slot_count(p_actor_id)>=3");
    expect(lifecycle).toContain("interest_limit integer not null default 6");
    expect(lifecycle).toContain("public.meetup_owner_active_slot_count(new.creator_id) > 3");
  });

  it("keeps stranger discovery to a coarse nearby server decision", () => {
    expect(lifecycle).toContain("public.meetup_distance_m");
    expect(lifecycle).toContain("<=15000");
    expect(projection).not.toContain("'latitude'");
    expect(projection).not.toContain("'longitude'");
  });

  it("grants stranger Meetup access only through accepted discovery participants", () => {
    expect(lifecycle).toContain("m.source_discovery_id is not null");
    expect(lifecycle).toContain("pa.response='accepted'");
    expect(lifecycle).toContain("pb.response='accepted'");
    expect(lifecycle).toContain("context_type='meetup'");
  });

  it("returns the server-authoritative listing refresh count", () => {
    expect(refreshProjection).toContain("'refreshCount',d.refresh_count");
  });

  it("does not allow a declined person to re-enter the same listing", () => {
    const guard = read("20261007144940_meet_new_people_decline_guard.sql");
    expect(guard).toContain("old.status='declined'");
    expect(guard).toContain("new.status='pending'");
    expect(guard).toContain("DISCOVERY_DECLINED");
  });

  it("does not count a discovery and its materialized Meetup as two slots", () => {
    expect(lifecycle).toContain("not exists(");
    expect(lifecycle).toContain("m.source_discovery_id=d.id");
  });
});
