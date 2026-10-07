import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..");
const migration = readFileSync(
  join(ROOT, "supabase/migrations/20261007132256_meet_up_beacon_lifecycle.sql"),
  "utf8"
);

describe("Meet Up Beacon lifecycle migration", () => {
  it("keeps Realtime membership authorization outside the exposed public RPC schema", () => {
    expect(migration).toContain("private.meetup_realtime_allowed");
    expect(migration).not.toContain("create or replace function public.meetup_realtime_allowed");
    expect(migration).toContain('drop policy if exists "meetup participants can receive broadcasts"');
  });

  it("keeps raw Beacon coordinates server-only", () => {
    expect(migration).toContain("beacon_latitude");
    expect(migration).toContain("'beaconStatus'");
    expect(migration).not.toContain("'beaconLatitude'");
    expect(migration).not.toContain("'beaconLongitude'");
  });

  it("expires unattended meetups and ends when every accepted participant leaves", () => {
    expect(migration).toContain("now() >= m.expires_at");
    expect(migration).toContain("now() >= m.starts_at + interval '2 hours'");
    expect(migration).toContain("p.response='accepted' and p.arrival<>'left'");
  });

  it("stores only coarse journey states for the shared Glow", () => {
    expect(migration).toContain("'approaching','nearby','at_spot'");
    expect(migration).toContain("refresh_meetup_proximity_server");
    expect(migration).not.toContain("'distanceMeters'");
  });
});
