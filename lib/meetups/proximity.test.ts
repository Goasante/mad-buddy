import { beforeEach, describe, expect, it, vi } from "vitest";
import { addMeetupProximity } from "./proximity";
import type { Meetup } from "./rules";
import { resolveFeatureDeniedIds } from "@/lib/social/permissions";
vi.mock("@/lib/social/permissions", () => ({ resolveFeatureDeniedIds: vi.fn().mockResolvedValue(new Set()) }));
const a = "10000000-0000-4000-8000-000000000001", b = "10000000-0000-4000-8000-000000000002";
const now = Date.parse("2026-10-06T12:00:00Z");
const person = (id: string) => ({ key: id, userId: id, name: "Muddy", response: "accepted" as const, arrival: "not_started" as const,
  delayMinutes: null, metAt: null, suggestedStartAt: null, proximityEnabled: true });
const meeting: Meetup = { id: a, creatorId: a, hostId: null, mode: "meet_somewhere", placeLabel: "Cafe", note: "", startsAt: new Date(now).toISOString(),
  timezone: "UTC", status: "active", revision: 1, members: [person(a), person(b)] };
let rows: Record<string, unknown[]>;
let failures: Set<string>;
const admin = { from(table: string) {
  const chain = { select() { return chain; }, in() { return chain; }, eq() { return chain; }, or() { return chain; }, is() { return chain; },
    maybeSingle() { return Promise.resolve({ data: rows[table]?.[0] ?? null, error: failures.has(table) ? new Error("read failed") : null }); },
    then(resolve: (v: unknown) => void) { return Promise.resolve({ data: rows[table] ?? [], error: failures.has(table) ? new Error("read failed") : null }).then(resolve); } };
  return chain;
} } as never;
beforeEach(() => {
  vi.mocked(resolveFeatureDeniedIds).mockReset().mockResolvedValue(new Set());
  failures = new Set();
  rows = { profiles: [a,b].map((id) => ({ user_id: id, full_name: "Muddy", username: "muddy", avatar_url: null, visibility_status: "visible" })),
    user_locations: [a,b].map((id) => ({ user_id: id, latitude: 5, longitude: 0, confidence: "high", last_updated: new Date(now).toISOString() })) };
});
describe("meetup proximity privacy", () => {
  it("removes an old hint before a fresh privacy read fails", async () => {
    const cached = { ...meeting, members: meeting.members.map((p) => ({ ...p, nearby: true, observedAt: new Date(now).toISOString() })) };
    failures.add("privacy_zones");
    expect(await addMeetupProximity(admin, a, [cached], now)).toEqual([meeting]);
  });
  it("returns a coarse hint, never coordinates, and never changes arrival", async () => {
    const result = await addMeetupProximity(admin, a, [meeting], now);
    expect(result[0].members[1].nearby).toBe(true);
    expect(JSON.stringify(result)).not.toMatch(/latitude|longitude|distance|accuracy/);
    expect(result[0].members[1].arrival).toBe("not_started");
  });
  it("needs explicit consent on both sides", async () => {
    for (const id of [a,b]) {
      const m = { ...meeting, members: meeting.members.map((p) => ({ ...p, proximityEnabled: p.userId !== id })) };
      expect(await addMeetupProximity(admin, a, [m], now)).toEqual([m]);
    }
  });
  it("hides Ghost Mode for viewer and peer", async () => {
    for (const id of [a,b]) {
      rows.profiles = [a,b].map((peer) => ({ user_id: peer, full_name: "Muddy", username: "muddy", avatar_url: null, visibility_status: peer === id ? "ghost" : "visible" }));
      expect(await addMeetupProximity(admin, a, [meeting], now)).toEqual([meeting]);
    }
  });
  it("hides either person's active privacy zone", async () => {
    for (const id of [a,b]) {
      rows.privacy_zones = [{ user_id: id, latitude: 5, longitude: 0, radius: 100 }];
      expect(await addMeetupProximity(admin, a, [meeting], now)).toEqual([meeting]);
    }
  });
  it("fails closed when any privacy read fails", async () => {
    for (const table of ["privacy_zones", "profiles", "blocked_users", "visibility_sessions"]) {
      failures = new Set([table]);
      expect(await addMeetupProximity(admin, a, [meeting], now)).toEqual([meeting]);
    }
  });
  it("hides stale and future-skewed fixes", async () => {
    for (const age of [121_000, -60_000]) {
      rows.user_locations = [a,b].map((id) => ({ user_id: id, latitude: 5, longitude: 0, confidence: "high", last_updated: new Date(now - age).toISOString() }));
      expect(await addMeetupProximity(admin, a, [meeting], now)).toEqual([meeting]);
    }
  });
  it("honors peer Glow exclusions and requests fail-closed reads", async () => {
    vi.mocked(resolveFeatureDeniedIds).mockResolvedValue(new Set([b]));
    expect(await addMeetupProximity(admin, a, [meeting], now)).toEqual([meeting]);
    expect(resolveFeatureDeniedIds).toHaveBeenCalledWith(admin, a, [b], "glow", now, true);
    vi.mocked(resolveFeatureDeniedIds).mockRejectedValue(new Error("privacy unavailable"));
    expect(await addMeetupProximity(admin, a, [meeting], now)).toEqual([meeting]);
  });
  it("honors the viewer's hidden Glow audience and failed target reads", async () => {
    rows.visibility_sessions = [{ id: a, visibility_mode: "hidden", ends_at: null }];
    expect(await addMeetupProximity(admin, a, [meeting], now)).toEqual([meeting]);
    rows.visibility_sessions = [{ id: a, visibility_mode: "all_muddies", ends_at: null }];
    failures.add("visibility_targets");
    expect(await addMeetupProximity(admin, a, [meeting], now)).toEqual([meeting]);
  });
  it("stops hints after leaving or outside the meetup window", async () => {
    const left = { ...meeting, members: meeting.members.map((p) => ({ ...p, arrival: "left" as const })) };
    expect(await addMeetupProximity(admin, a, [left], now)).toEqual([left]);
    expect(await addMeetupProximity(admin, a, [meeting], now + 3 * 60 * 60_000)).toEqual([meeting]);
  });
});
