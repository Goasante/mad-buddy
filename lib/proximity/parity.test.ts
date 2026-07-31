import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

describe("canonical proximity parity", () => {
  it("keeps all three in-range buckets on web and mobile Home", () => {
    const web = read("components/dashboard/dashboard-page.tsx");
    const mobile = read("mobile/src/screens/HomeScreen.tsx");

    expect(web).toContain('friend.proximityLevel === "close"');
    expect(web).toContain('friend.proximityLevel === "near"');
    expect(web).toContain('friend.proximityLevel === "far"');
    expect(mobile).toContain('friends.filter((f) => f.proximity_level !== "hidden")');
    expect(mobile).not.toContain('f.proximity_level !== "far"');
  });

  it("does not turn missing proximity into a valid Far signal", () => {
    const sharedAvatar = read("components/glow/glow-avatar.tsx");
    const webMuddies = read("components/friends/friends-page.tsx");
    const mobileMuddies = read("mobile/src/screens/MuddiesScreen.tsx");

    expect(sharedAvatar).toContain('const resolvedProximityLevel = proximityLevel ?? "hidden"');
    expect(sharedAvatar).not.toContain('proximityLevel = "far"');
    expect(webMuddies).not.toContain('proximity?.proximityLevel ?? "far"');
    expect(mobileMuddies).not.toContain('near?.proximity_level ?? "far"');
  });

  it("includes Far in the fresh nearby-Moments audience", () => {
    const service = read("lib/content/service.ts");
    expect(service).toContain('friend.proximity_level !== "hidden"');
    expect(service).not.toContain('friend.proximity_level !== "far"');
  });

  it("keeps Socialize on the shared 15km-safe backend and canonical tiers", () => {
    const service = read("lib/social/socialize-mobile.ts");
    const rules = read("lib/social/socialize.ts");

    expect(service).toContain("buildSafeNearbyFriends");
    expect(service).toContain('tier !== "close" && tier !== "near" && tier !== "far"');
    expect(rules).toContain('wider_area: ["close", "near", "far"]');
    expect(service).not.toMatch(/25_000|50_000|100_000/);
  });

  it("keeps notification and Pulse behavior bounded by the safe nearby result", () => {
    const nearbyRoute = read("app/api/friends/nearby/route.ts");
    const pulseRoute = read("app/api/pulse/route.ts");

    // Preserve the narrower existing alert threshold to avoid a deployment
    // notification surge; Far still appears in Pulse as an in-range signal.
    expect(nearbyRoute).toContain('friend.proximity_level === "close" || friend.proximity_level === "near"');
    expect(pulseRoute).toContain('nearby.filter((friend) => friend.proximity_level !== "hidden")');
  });

  it("uses only the canonical bucket vocabulary on public proximity surfaces", () => {
    const publicCopy = [
      read("components/landing/landing-page.tsx"),
      read("components/legal/about-page.tsx"),
      read("content/privacy-policy.ts")
    ].join("\n");
    const backend = read("lib/proximity/backend.ts");

    expect(publicCopy).toContain("Close, Near, or Far");
    expect(publicCopy).not.toMatch(/Very close|Around you/);
    expect(backend).toContain('return "Close and glowing clearly"');
    expect(backend).not.toContain('return "Very close and glowing clearly"');
  });

  it("migrates only the canonical proximity enum and preserves other preferences", () => {
    const migration = read("supabase/migrations/20260801130000_proximity_range_tightened.sql");
    const generatedTypes = read("lib/supabase/database.types.ts");

    expect(migration).toContain("update public.proximity_events set proximity_level = 'far' where proximity_level = 'around'");
    expect(migration).toContain("create type public.proximity_level as enum ('close', 'near', 'far', 'hidden')");
    expect(migration.match(/alter table public\.[a-z_]+/g)).toEqual([
      "alter table public.proximity_events",
      "alter table public.proximity_events"
    ]);
    expect(migration).not.toContain("very_close_only");
    expect(generatedTypes).toContain('export type ProximityLevel = "close" | "near" | "far" | "hidden"');
    expect(generatedTypes).toContain('| "very_close_only"');
  });
});
