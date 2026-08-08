import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { stripComments } from "@/lib/content/strip-comments";
import { canStrangerDiscoverUpFor } from "@/lib/social/upfor-discovery";

/**
 * Stage 5c: the stranger read path.
 *
 * The gate itself is exercised as arithmetic; the wiring is asserted against
 * the action's source, which is this project's pattern for server paths that
 * cannot be run without a database.
 */

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const actions = stripComments(read("app/(app)/hangout-actions.ts"));
const loader = actions.slice(actions.indexOf("async function filterStrangerDiscoverable"));
const gate = loader.slice(0, loader.indexOf("export async function getVisibleHangoutsAction"));
const discovery = actions.slice(actions.indexOf("export async function getVisibleHangoutsAction"));

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
// Who appears, and who does not
// ---------------------------------------------------------------------------

describe("a nearby stranger appears; a far one does not", () => {
  it("admits a close stranger who passes every gate", () => {
    expect(canStrangerDiscoverUpFor(gates({ proximityLevel: "close" }))).toBe(true);
    expect(canStrangerDiscoverUpFor(gates({ proximityLevel: "near" }))).toBe(true);
  });

  it("excludes one who is merely in the wider area", () => {
    expect(canStrangerDiscoverUpFor(gates({ proximityLevel: "far" }))).toBe(false);
  });

  it("excludes one the engine declined to place", () => {
    // "hidden" is what buildSafeNearbyFriends returns when it will not say.
    expect(canStrangerDiscoverUpFor(gates({ proximityLevel: "hidden" }))).toBe(false);
    expect(canStrangerDiscoverUpFor(gates({ proximityLevel: null }))).toBe(false);
  });
});

describe("stale locations fail closed on both sides", () => {
  it("drops a session whose creator's position has aged out", () => {
    expect(canStrangerDiscoverUpFor(gates({ creatorLocationUpdatedAt: at(-16 * 60_000) }))).toBe(false);
  });

  it("drops it when the creator has no position at all", () => {
    expect(canStrangerDiscoverUpFor(gates({ creatorLocationUpdatedAt: null }))).toBe(false);
  });

  it("returns nothing at all when the VIEWER's position is stale", () => {
    // Checked once, before any candidate is considered: without a viewer
    // position there is nothing to compare against.
    expect(gate).toContain("if (!viewerLocation || !isLocationFreshEnough(viewerLocation.last_updated, nowMs)) return [];");
  });
});

describe("blocks, ghost mode and restrictions fail closed", () => {
  it("drops a blocked pair whatever the distance", () => {
    expect(canStrangerDiscoverUpFor(gates({ blockedEitherWay: true, proximityLevel: "close" }))).toBe(false);
  });

  it("checks blocks in BOTH directions", () => {
    // flatMap over both columns, so blocking and being blocked both count.
    expect(gate).toContain("blocks ?? []).flatMap((row) => [row.blocker_id, row.blocked_id])");
  });

  it("drops a creator in ghost mode", () => {
    expect(canStrangerDiscoverUpFor(gates({ creatorVisibilityStatus: "ghost" }))).toBe(false);
  });

  it("drops a restricted creator, through the existing enforcement", () => {
    expect(canStrangerDiscoverUpFor(gates({ creatorRestricted: true }))).toBe(false);
    expect(gate).toContain("guardAction(admin, { userId: session.owner_id");
  });
});

describe("Muddies-only sessions never reach strangers", () => {
  it("requires an explicit opt-in in the gate", () => {
    expect(canStrangerDiscoverUpFor(gates({ discoveryScope: "muddies" }))).toBe(false);
  });

  it("queries only opted-in rows in the first place", () => {
    // Defence in depth: the query narrows, and the gate narrows again.
    expect(discovery).toContain('.eq("discovery_scope", "nearby")');
  });

  it("never treats the area text as authorization", () => {
    expect(gate).not.toContain("broad_area_text");
    expect(gate).not.toContain("broadArea");
  });
});

// ---------------------------------------------------------------------------
// Merging the two paths
// ---------------------------------------------------------------------------

describe("the two paths merge without duplicating or reordering", () => {
  it("keeps the Muddies gate exactly as it was", () => {
    expect(discovery).toContain("if (await canViewHangout(admin, userId, session)) visible.push(session);");
  });

  it("dedupes by id when a session qualifies through both", () => {
    // An owner can become a Muddy after opting in; the session must appear
    // once, not twice.
    expect(discovery).toContain("const seen = new Set(visible.map((session) => session.id))");
    expect(discovery).toContain("if (!seen.has(session.id))");
  });

  it("skips re-reading sessions already covered by the Muddies path", () => {
    expect(discovery).toContain("!friendIds.includes(session.owner_id)");
  });

  it("sorts both paths through one ordering, applied after the merge", () => {
    // Two separately-sorted lists concatenated are not sorted.
    expect(discovery).toContain("visible.sort((a, b) => Date.parse(a.ends_at) - Date.parse(b.ends_at))");
  });

  it("no longer returns early when the viewer has no Muddies", () => {
    // That early return would have made stranger discovery a Muddies-only
    // feature — the exact bug it was hiding.
    expect(discovery).not.toContain("if (friendIds.length === 0) return [];");
  });

  it("selects one column list for both paths", () => {
    expect(actions).toContain("const HANGOUT_DISCOVERY_COLUMNS");
    expect((discovery.match(/HANGOUT_DISCOVERY_COLUMNS/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// Nothing location-shaped escapes
// ---------------------------------------------------------------------------

describe("no coordinates leave the server", () => {
  it("reads coordinates only inside the gate", () => {
    // They enter filterStrangerDiscoverable and never come back out: what
    // returns is a list of session rows.
    expect(gate).toContain('.select("latitude, longitude, confidence, last_updated")');
    expect(gate).toContain("Promise<HangoutDiscoveryRow[]>");
  });

  it("keeps coordinates out of the returned projection", () => {
    const projection = actions.slice(actions.indexOf("export type VisibleHangout"));
    const shape = projection.slice(0, projection.indexOf("};"));
    for (const absent of ["latitude", "longitude", "distance", "accuracy", "coord"]) {
      expect(shape.toLowerCase()).not.toContain(absent);
    }
  });

  it("keeps them out of the shared column list too", () => {
    const columns = actions.slice(actions.indexOf("const HANGOUT_DISCOVERY_COLUMNS"));
    const value = columns.slice(0, columns.indexOf(";"));
    expect(value).not.toContain("latitude");
    expect(value).not.toContain("longitude");
  });

  it("computes proximity through the canonical engine, not its own maths", () => {
    // buildSafeNearbyFriends returns coarse levels only and is already
    // guarded against location-shaped response keys.
    expect(gate).toContain("buildSafeNearbyFriends({");
    expect(gate).not.toContain("Math.sqrt");
    expect(gate).not.toContain("haversine");
  });

  it("uses the viewer-relative level, never the row's stored tier", () => {
    // The stored tier describes how precisely we know where the CREATOR is.
    // Using it for authorization would make one person's answer everybody's.
    expect(gate).toContain("levelByOwner.get(session.owner_id)");
    expect(gate).not.toContain("session.area_tier");
  });
});
