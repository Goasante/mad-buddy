import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function read(name: string) {
  return fs.readFileSync(path.join(process.cwd(), "supabase", "migrations", name), "utf8");
}

describe("Meet New People database boundary", () => {
  const lifecycle = read("20261007141400_meet_new_people_discovery.sql");
  const projection = read("20261007144500_meet_new_people_projection_v2.sql");

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

  it("does not count a discovery and its materialized Meetup as two slots", () => {
    expect(lifecycle).toContain("not exists(");
    expect(lifecycle).toContain("m.source_discovery_id=d.id");
  });
});
