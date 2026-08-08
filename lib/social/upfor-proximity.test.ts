import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { stripComments } from "@/lib/content/strip-comments";
import { UPFOR_NEARBY_TIERS, isUpForNearby, upForPlaceLabel } from "@/lib/social/upfor";
import {
  UPFOR_LOCATION_MAX_AGE_MS,
  canStrangerDiscoverUpFor,
  confidenceToAreaTier,
  isLocationFreshEnough,
  tierForProximityLevel
} from "@/lib/social/upfor-discovery";
import { applyUpForFilters } from "@/lib/social/upfor-filters";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const migration = read("supabase/migrations/20260808180000_upfor_area_and_discovery.sql");
const actions = stripComments(read("app/(app)/hangout-actions.ts"));
const page = stripComments(read("components/hangout/hangout-mode-page.tsx"));
const sheet = stripComments(read("components/hangout/upfor-detail-sheet.tsx"));

const NOW = Date.parse("2026-08-08T12:00:00.000Z");
const at = (ms: number) => new Date(NOW + ms).toISOString();

const gates = (overrides: Partial<Parameters<typeof canStrangerDiscoverUpFor>[0]> = {}) => ({
  discoveryScope: "nearby",
  sessionStatus: "active",
  endsAt: at(60 * 60_000),
  creatorLocationUpdatedAt: at(-60_000),
  viewerHasLocation: true,
  blockedEitherWay: false,
  creatorVisibilityStatus: "visible",
  creatorRestricted: false,
  proximityLevel: "close" as const,
  nowMs: NOW,
  ...overrides
});

// ---------------------------------------------------------------------------
// Stage 5a — tier derivation and the Nearby filter
// ---------------------------------------------------------------------------

describe("the tier is server-derived, never client-supplied", () => {
  it("accepts no area tier from the client", () => {
    // A client that could submit its own tier could claim to be "close by"
    // to everyone.
    const schema = actions.slice(0, actions.indexOf("export async function startHangoutAction"));
    expect(schema).not.toContain("areaTier: z.");
    expect(schema).not.toContain("area_tier: z.");
  });

  it("derives from the creator's own location row", () => {
    expect(actions).toContain('from("user_locations")');
    expect(actions).toContain("confidenceToAreaTier(location.confidence)");
  });

  it("reads confidence and timestamp only, never coordinates", () => {
    const derivation = actions.slice(actions.indexOf("const derivedArea = await"));
    const block = derivation.slice(0, derivation.indexOf("const { data: session"));
    expect(block).toContain('.select("confidence, last_updated")');
    expect(block).not.toContain("latitude");
    expect(block).not.toContain("longitude");
  });

  it("maps confidence to a band, and unknown to no claim", () => {
    expect(confidenceToAreaTier("high")).toBe("close_by");
    expect(confidenceToAreaTier("medium")).toBe("nearby");
    expect(confidenceToAreaTier("low")).toBe("wider_area");
    expect(confidenceToAreaTier(null)).toBeNull();
    expect(confidenceToAreaTier("nonsense")).toBeNull();
  });

  it("inverts Linkr's own tier map rather than restating thresholds", () => {
    expect(tierForProximityLevel("close")).toBe("close_by");
    expect(tierForProximityLevel("near")).toBe("nearby");
    expect(tierForProximityLevel("far")).toBe("wider_area");
    expect(tierForProximityLevel("hidden")).toBeNull();
  });
});

describe("Nearby means close_by or nearby, and nothing else", () => {
  it("includes close_by and nearby", () => {
    expect(isUpForNearby("close_by")).toBe(true);
    expect(isUpForNearby("nearby")).toBe(true);
  });

  it("excludes wider_area, the widest band the product has", () => {
    // Admitting it would return almost everything, which is indistinguishable
    // from no filter at all.
    expect(isUpForNearby("wider_area")).toBe(false);
    expect(UPFOR_NEARBY_TIERS).not.toContain("wider_area");
  });

  it("excludes a null tier: unknown is not near", () => {
    expect(isUpForNearby(null)).toBe(false);
  });

  it("filters legacy rows out rather than crashing on them", () => {
    // Every pre-migration session has area_tier NULL.
    const legacy = {
      activityType: "food" as const,
      areaTier: null,
      endsAt: at(60 * 60_000),
      goingCount: 1,
      maxParticipants: 5,
      myRequestStatus: null
    };
    const nearbyOnly = { toggles: new Set(["nearby" as const]), activity: null };
    expect(applyUpForFilters([legacy], nearbyOnly, NOW)).toHaveLength(0);
    // And remains visible with no filter applied.
    expect(applyUpForFilters([legacy], { toggles: new Set(), activity: null }, NOW)).toHaveLength(1);
  });

  it("never infers Nearby from the area text", () => {
    const registry = read("lib/social/upfor-filters.ts");
    const nearby = registry.slice(registry.indexOf('id: "nearby"'));
    expect(nearby.slice(0, 400)).not.toContain("broadAreaText");
  });
});

// ---------------------------------------------------------------------------
// Freshness
// ---------------------------------------------------------------------------

describe("a stale location stops claiming proximity", () => {
  it("reuses the existing freshness band rather than a new window", () => {
    expect(UPFOR_LOCATION_MAX_AGE_MS).toBe(15 * 60 * 1000);
  });

  it("accepts a recent position", () => {
    expect(isLocationFreshEnough(at(-60_000), NOW)).toBe(true);
  });

  it("rejects one past the window", () => {
    expect(isLocationFreshEnough(at(-16 * 60_000), NOW)).toBe(false);
  });

  it("rejects a missing or unparseable timestamp", () => {
    expect(isLocationFreshEnough(null, NOW)).toBe(false);
    expect(isLocationFreshEnough("not-a-date", NOW)).toBe(false);
  });

  it("ages the tier out of the projection rather than showing stale certainty", () => {
    // A tier is a claim about now; keeping it would say "Close by" long after
    // it stopped being true.
    expect(actions).toContain("isLocationFreshEnough(session.area_derived_at, Date.now())");
  });

  it("keeps the creator's own area text, which is not a claim about now", () => {
    expect(actions).toContain("broadAreaText: session.broad_area_text");
  });
});

// ---------------------------------------------------------------------------
// Presentation — one formatter
// ---------------------------------------------------------------------------

describe("card and sheet cannot disagree about place", () => {
  it("combines area and tier when both exist", () => {
    expect(upForPlaceLabel({ broadAreaText: "Osu", areaTier: "close_by" })).toBe("Osu · Close by");
  });

  it("shows whichever one it has", () => {
    expect(upForPlaceLabel({ broadAreaText: "Osu", areaTier: null })).toBe("Osu");
    expect(upForPlaceLabel({ broadAreaText: null, areaTier: "nearby" })).toBe("Nearby");
  });

  it("returns null when it knows neither, so the row is hidden", () => {
    expect(upForPlaceLabel({ broadAreaText: null, areaTier: null })).toBeNull();
    expect(upForPlaceLabel({ broadAreaText: "   ", areaTier: null })).toBeNull();
  });

  it("is the single formatter both surfaces call", () => {
    expect(page).toContain("upForPlaceLabel(item)");
    expect(sheet).toContain("upForPlaceLabel(upFor)");
  });

  it("never renders a distance", () => {
    for (const surface of [page, sheet]) {
      for (const absent of ["km away", "metres", " miles", "latitude", "longitude"]) {
        expect(surface).not.toContain(absent);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Stage 5b — the migration's safety properties
// ---------------------------------------------------------------------------

describe("existing UpFors stay as private as they were", () => {
  it("defaults discovery_scope to muddies", () => {
    // The whole safety property: no row already in the table becomes visible
    // to strangers because a column appeared.
    expect(migration).toContain("discovery_scope text not null default 'muddies'");
  });

  it("leaves area_tier NULL rather than fabricating history", () => {
    // These sessions predate the column; their creators' past locations were
    // never recorded against them.
    expect(migration).toContain("add column if not exists area_tier text");
    expect(migration).not.toContain("update public.hangout_sessions set area_tier");
  });

  it("leaves the Muddies read policy untouched", () => {
    expect(migration).not.toContain('drop policy if exists "muddies read active hangouts"');
  });

  it("stores no coordinates on the UpFor row", () => {
    // Matched against the DDL only: the prose above it discusses coordinates
    // precisely in order to say they are not stored.
    const ddl = migration
      .split(String.fromCharCode(10))
      .filter((line) => !line.trimStart().startsWith("--"))
      .join(" ")
      .toLowerCase();
    for (const absent of ["latitude", "longitude", "geography", "geometry", " point"]) {
      expect(ddl).not.toContain(absent);
    }
  });
});

describe("the discovery policy is a boundary, not the gate", () => {
  const policy = migration.slice(migration.indexOf('create policy "opted-in upfors are discovery eligible"'));

  it("admits only explicitly opted-in, live sessions", () => {
    expect(policy).toContain("discovery_scope = 'nearby'");
    expect(policy).toContain("status = 'active'");
    expect(policy).toContain("ends_at > now()");
  });

  it("requires an authenticated viewer", () => {
    expect(policy).toContain("auth.uid() is not null");
  });

  it("creates no broad read-for-all-authenticated rule", () => {
    // Which is what this would be without the discovery_scope predicate.
    expect(policy).toContain("discovery_scope");
  });
});

// ---------------------------------------------------------------------------
// Stage 5b — the gates
// ---------------------------------------------------------------------------

describe("a nearby stranger passes only when everything passes", () => {
  it("admits a fully qualified viewer", () => {
    expect(canStrangerDiscoverUpFor(gates())).toBe(true);
  });

  it("denies when the creator did not opt in", () => {
    expect(canStrangerDiscoverUpFor(gates({ discoveryScope: "muddies" }))).toBe(false);
  });

  it("denies an ended or cancelled session", () => {
    expect(canStrangerDiscoverUpFor(gates({ endsAt: at(-1) }))).toBe(false);
    expect(canStrangerDiscoverUpFor(gates({ sessionStatus: "cancelled" }))).toBe(false);
  });

  it("denies when the creator's location is stale or missing", () => {
    expect(canStrangerDiscoverUpFor(gates({ creatorLocationUpdatedAt: at(-16 * 60_000) }))).toBe(false);
    expect(canStrangerDiscoverUpFor(gates({ creatorLocationUpdatedAt: null }))).toBe(false);
  });

  it("denies when the viewer has no location of their own", () => {
    expect(canStrangerDiscoverUpFor(gates({ viewerHasLocation: false }))).toBe(false);
  });

  it("denies a block in either direction, whatever the proximity", () => {
    // Proximity never overrides a block.
    expect(canStrangerDiscoverUpFor(gates({ blockedEitherWay: true, proximityLevel: "close" }))).toBe(false);
  });

  it("denies a creator in ghost mode", () => {
    expect(canStrangerDiscoverUpFor(gates({ creatorVisibilityStatus: "ghost" }))).toBe(false);
  });

  it("denies a restricted creator", () => {
    expect(canStrangerDiscoverUpFor(gates({ creatorRestricted: true }))).toBe(false);
  });

  it("denies when proximity is too wide or unknown", () => {
    expect(canStrangerDiscoverUpFor(gates({ proximityLevel: "far" }))).toBe(false);
    expect(canStrangerDiscoverUpFor(gates({ proximityLevel: null }))).toBe(false);
    expect(canStrangerDiscoverUpFor(gates({ proximityLevel: "hidden" }))).toBe(false);
  });

  it("differs correctly between viewers of the same session", () => {
    // The same UpFor is discoverable for a close viewer and not for a far
    // one — which is why the tier can never be stored as universal truth.
    expect(canStrangerDiscoverUpFor(gates({ proximityLevel: "close" }))).toBe(true);
    expect(canStrangerDiscoverUpFor(gates({ proximityLevel: "far" }))).toBe(false);
  });

  it("never treats the area text as authorization", () => {
    const source = read("lib/social/upfor-discovery.ts");
    expect(source).not.toContain("broadArea");
    expect(source).not.toContain("broad_area_text");
  });
});

// ---------------------------------------------------------------------------
// Create flow
// ---------------------------------------------------------------------------

describe("the creator chooses, and the default is private", () => {
  it("defaults the choice to Muddies only", () => {
    expect(page).toContain('useState<"muddies" | "nearby">("muddies")');
    expect(actions).toContain('discoveryScope: z.enum(["muddies", "nearby"]).default("muddies")');
  });

  it("offers both options with an honest explanation", () => {
    expect(page).toContain("Muddies only");
    expect(page).toContain("Nearby people");
    expect(page).toContain("People nearby can discover this and ask to join.");
    // UpFor stands on its own: naming another feature here described the
    // plumbing rather than what happens.
    expect(page).not.toContain("who use Linkr");
  });

  it("never implies exact location sharing", () => {
    expect(page).toContain("Your exact location is never shared.");
  });

  it("says up front that nearby needs a recent location", () => {
    // Rather than silently widening, or silently failing.
    expect(page).toContain("Needs a recent location");
  });

  it("falls back to muddies when the creator cannot be placed", () => {
    // A session nobody can be matched against has no business being offered
    // to strangers.
    expect(actions).toContain('derivedArea.tier === null ? "muddies" : parsed.data.discoveryScope');
  });

  it("keeps the area optional", () => {
    expect(actions).toContain("broadAreaText: z.string().max(80).optional()");
  });
});
