import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { validateScheduledStart } from "@/lib/time/timezone";
import { rankPopular, type RankableUpFor } from "@/lib/social/upfor-feed";
import { shouldShowConvertedUpForOnHome } from "@/lib/social/upfor-home-plan";
import { isHappeningNow } from "@/lib/social/upfor-filters";
import { upForTitle } from "@/lib/social/upfor";

const now = new Date("2026-10-06T16:00:00Z");
const later = "2026-10-10T18:00:00Z";
const item = (id: string, goingCount: number, startsAt: string): RankableUpFor => ({
  id, goingCount, startsAt, ownerId: "owner", activityType: "food", areaTier: null,
  endsAt: "2026-10-10T20:00:00Z", isMuddy: true, viaGroup: false
});

describe("UpFor future scheduling and discovery", () => {
  it("accepts tomorrow and later dates", () => {
    expect(validateScheduledStart(new Date(later), now, "Africa/Accra")).toEqual({ ok: true });
  });
  it("rejects past dates, malformed timestamps and invalid zones", () => {
    expect(validateScheduledStart(now, now, "UTC").ok).toBe(false);
    expect(validateScheduledStart(new Date("bad"), now, "UTC").ok).toBe(false);
    expect(validateScheduledStart(new Date(later), now, "bad").ok).toBe(false);
  });
  it("ranks future activities by interest without mutating the feed", () => {
    const entries = [item("now", 2, now.toISOString()), item("later", 8, later)];
    expect(rankPopular(entries, now.getTime()).map((row) => row.id)).toEqual(["later", "now"]);
    expect(entries[0].id).toBe("now");
  });
  it("counts pending interest in Popular without changing who's going", () => {
    const pending = { ...item("pending", 1, later), interestCount: 10 };
    const accepted = { ...item("accepted", 5, now.toISOString()), interestCount: 5 };
    expect(rankPopular([accepted, pending], now.getTime())[0]).toBe(pending);
    expect(pending.goingCount).toBe(1);
  });
  it("does not label future activities as happening now", () => {
    expect(isHappeningNow({ startsAt: later, endsAt: "2026-10-10T20:00:00Z" }, now.getTime())).toBe(false);
    expect(upForTitle("food", true)).not.toContain("now");
  });
  it("allows both server discovery paths to include future sessions", () => {
    const action = readFileSync("app/(app)/hangout-actions.ts", "utf8");
    expect(action).not.toContain('.lte("starts_at", nowIso)');
    expect(action).toContain("canViewHangout(admin, userId, session)");
    expect(action).toContain("filterStrangerDiscoverable(admin, userId, strangerCandidates)");
  });
});

describe("homepage converted Plans", () => {
  it("excludes Now but retains a future-intent Plan", () => {
    expect(shouldShowConvertedUpForOnHome({ starts_at: now.toISOString(), created_at: now.toISOString() })).toBe(false);
    expect(shouldShowConvertedUpForOnHome({ starts_at: later, created_at: now.toISOString() })).toBe(true);
  });
  it("fails closed on unknown source timing", () => {
    expect(shouldShowConvertedUpForOnHome(null)).toBe(false);
    expect(shouldShowConvertedUpForOnHome({ starts_at: "bad", created_at: now.toISOString() })).toBe(false);
  });
});
