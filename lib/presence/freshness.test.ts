import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  PRESENCE_FRESH_MS,
  PRESENCE_GRACE_MS,
  isPresenceVisible,
  presenceLabel,
  presenceStateFor
} from "@/lib/presence/freshness";
import { stripComments } from "@/lib/content/strip-comments";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const NOW = Date.UTC(2026, 7, 6, 12, 0, 0);
const MIN = 60_000;
const at = (msAgo: number) => new Date(NOW - msAgo).toISOString();

// ---------------------------------------------------------------------------
// Boundaries
// ---------------------------------------------------------------------------

describe("freshness boundaries", () => {
  it("is fresh for a recent update", () => {
    expect(presenceStateFor(at(0), NOW)).toBe("fresh");
    expect(presenceStateFor(at(2 * MIN), NOW)).toBe("fresh");
  });

  it("is fresh right up to the threshold, inclusive", () => {
    expect(presenceStateFor(at(PRESENCE_FRESH_MS), NOW)).toBe("fresh");
  });

  it("enters grace one millisecond past fresh", () => {
    expect(presenceStateFor(at(PRESENCE_FRESH_MS + 1), NOW)).toBe("grace");
  });

  it("stays in grace up to the grace threshold, inclusive", () => {
    expect(presenceStateFor(at(5 * MIN), NOW)).toBe("grace");
    expect(presenceStateFor(at(PRESENCE_GRACE_MS), NOW)).toBe("grace");
  });

  it("expires one millisecond past grace", () => {
    expect(presenceStateFor(at(PRESENCE_GRACE_MS + 1), NOW)).toBe("expired");
  });

  it("is expired well beyond the window", () => {
    expect(presenceStateFor(at(30 * MIN), NOW)).toBe("expired");
    expect(presenceStateFor(at(24 * 60 * MIN), NOW)).toBe("expired");
  });

  it("keeps the thresholds ordered and in one place", () => {
    expect(PRESENCE_FRESH_MS).toBeLessThan(PRESENCE_GRACE_MS);
    // Justified by the 2-minute LocationSignalSync cadence: fresh tolerates
    // one missed update, expiry needs roughly three.
    expect(PRESENCE_FRESH_MS).toBeGreaterThanOrEqual(2 * MIN);
    expect(PRESENCE_GRACE_MS).toBeGreaterThanOrEqual(3 * 2 * MIN);
  });
});

// ---------------------------------------------------------------------------
// Unusable input
// ---------------------------------------------------------------------------

describe("unusable timestamps", () => {
  it("treats a missing timestamp as expired", () => {
    // Absence of evidence is not evidence of presence.
    expect(presenceStateFor(null, NOW)).toBe("expired");
    expect(presenceStateFor(undefined, NOW)).toBe("expired");
    expect(presenceStateFor("", NOW)).toBe("expired");
  });

  it("treats an invalid timestamp as expired", () => {
    for (const bad of ["not-a-date", "2026-13-45T99:99:99Z", "{}", "0000"]) {
      expect(presenceStateFor(bad, NOW), `${bad} should not be trusted`).toBe("expired");
    }
  });

  it("tolerates modest clock skew from the device", () => {
    // A device a few seconds ahead is skew, not staleness. Penalising it
    // would hide someone who is genuinely present.
    expect(presenceStateFor(new Date(NOW + 5_000).toISOString(), NOW)).toBe("fresh");
    expect(presenceStateFor(new Date(NOW + 30_000).toISOString(), NOW)).toBe("fresh");
  });

  it("refuses to trust a wildly future timestamp", () => {
    expect(presenceStateFor(new Date(NOW + 10 * MIN).toISOString(), NOW)).toBe("expired");
    expect(presenceStateFor(new Date(NOW + 365 * 24 * 60 * MIN).toISOString(), NOW)).toBe("expired");
  });
});

// ---------------------------------------------------------------------------
// Aging
// ---------------------------------------------------------------------------

describe("aging while backgrounded", () => {
  it("walks fresh → grace → expired as time passes with no new update", () => {
    // The whole point: one timestamp, re-evaluated as the clock moves.
    const lastUpdate = at(0);
    expect(presenceStateFor(lastUpdate, NOW)).toBe("fresh");
    expect(presenceStateFor(lastUpdate, NOW + 5 * MIN)).toBe("grace");
    expect(presenceStateFor(lastUpdate, NOW + 10 * MIN)).toBe("expired");
  });

  it("returns to fresh when a new update arrives", () => {
    expect(presenceStateFor(at(10 * MIN), NOW)).toBe("expired");
    expect(presenceStateFor(at(0), NOW)).toBe("fresh");
  });
});

// ---------------------------------------------------------------------------
// Derived behaviour
// ---------------------------------------------------------------------------

describe("derived behaviour", () => {
  it("shows fresh and grace, hides expired", () => {
    expect(isPresenceVisible("fresh")).toBe(true);
    expect(isPresenceVisible("grace")).toBe(true);
    expect(isPresenceVisible("expired")).toBe(false);
  });

  it("hedges only where certainty is lacking", () => {
    expect(presenceLabel("fresh")).toBeNull();
    expect(presenceLabel("grace")).toBe("Recently active");
    expect(presenceLabel("expired")).toBeNull();
  });

  it("never claims certainty in the grace wording", () => {
    const label = presenceLabel("grace") ?? "";
    for (const banned of ["now", "here", "online", "live"]) {
      expect(label.toLowerCase(), `grace must not claim "${banned}"`).not.toContain(banned);
    }
  });
});

// ---------------------------------------------------------------------------
// Purity and privacy
// ---------------------------------------------------------------------------

describe("module boundaries", () => {
  const source = stripComments(read("lib/presence/freshness.ts"));

  it("is pure", () => {
    for (const banned of ["useState", "useEffect", "createSupabase", "fetch(", "Math.random"]) {
      expect(source, `freshness must not use ${banned}`).not.toContain(banned);
    }
    expect(presenceStateFor(at(MIN), NOW)).toBe(presenceStateFor(at(MIN), NOW));
  });

  it("returns only the three approved states", () => {
    const inputs = [null, undefined, "", "bad", at(0), at(5 * MIN), at(30 * MIN)];
    for (const input of inputs) {
      expect(["fresh", "grace", "expired"]).toContain(presenceStateFor(input, NOW));
    }
  });

  it("exposes no location data", () => {
    for (const banned of ["latitude", "longitude", "coordinates", "accuracy", "confidence"]) {
      expect(source, `freshness must not touch ${banned}`).not.toContain(banned);
    }
  });

  it("returns a state rather than an age or a timestamp", () => {
    // Callers get a classification, never a number they could render.
    expect(typeof presenceStateFor(at(MIN), NOW)).toBe("string");
  });
});

// ---------------------------------------------------------------------------
// Socialize integration
// ---------------------------------------------------------------------------

describe("Socialize integration", () => {
  const service = read("lib/social/socialize-mobile.ts");
  const page = read("components/socialize/socialize-page.tsx");
  const sheet = read("components/socialize/people-nearby-sheet.tsx");

  it("projects a server-derived state rather than a raw timestamp for display", () => {
    const projection = service.slice(
      service.indexOf("export type SocializePerson"),
      service.indexOf("export type SocializeActionResult")
    );
    expect(projection).toContain("presenceState: PresenceState;");
    expect(projection).toContain("lastPresenceUpdate: string | null;");
  });

  it("drops expired people at the source", () => {
    // A session that has not expired is not proof the device is reporting.
    expect(service).toContain('if (presenceState === "expired") continue;');
    expect(service).toContain("presenceStateFor(lastPresenceUpdate, Date.parse(nowIso))");
  });

  it("reuses the location row the query already selects", () => {
    // No second query: last_updated is already fetched for proximity.
    expect(service).toContain("last_updated");
    expect(service).toContain("locationByUserId.get(candidate.friend_id)");
  });

  it("re-derives presence on the client against the ticking clock", () => {
    // So a retained list ages out without needing a successful refresh.
    expect(page).toContain("isPresenceVisible(presenceStateFor(person.lastPresenceUpdate, nowMs))");
    expect(page).toContain("const visiblePeople = useMemo(");
  });

  it("feeds the radar, the list and the state resolver from the filtered set", () => {
    // One source, so an expired person cannot linger in one surface only.
    expect(page).toContain("buildRadarField(isActive ? visiblePeople : []");
    expect(page).toContain("people={visiblePeople}");
    expect(page).toContain("peopleCount: visiblePeople.length");
  });

  it("clears a selected person who ages out, through the existing path", () => {
    expect(page).toContain(
      "visiblePeople.some((candidate) => candidate.userId === previewPerson.userId)"
    );
    expect(page).toContain('showToast("This person is no longer available.");');
  });

  it("hedges grace people in both surfaces identically", () => {
    expect(page).toContain("const hedge = presenceLabel(presence);");
    expect(sheet).toContain("const hedge = presenceLabel(presenceStateFor(person.lastPresenceUpdate, nowMs));");
    // The same clock drives both.
    expect(page).toContain("nowMs={nowMs}");
  });

  it("replaces the proximity wording rather than claiming both", () => {
    // "Close · Recently active" would assert presence and hedge it at once.
    expect(page).toContain("{hedge ?? proximityLabels[person.proximityTier]}");
    expect(sheet).toContain("{hedge ?? proximity}");
  });

  it("keeps angles identity-based, so survivors do not move", () => {
    // Filtering changes WHO is placed, never the angle anyone gets.
    const layout = read("lib/social/radar-layout.ts");
    expect(layout).toContain("identityAngle(person.userId)");
    expect(page).toContain("buildRadarField(isActive ? visiblePeople : []");
  });

  it("leaks no timestamp, cadence or location to the rendered UI", () => {
    const rendered = stripComments(page) + stripComments(sheet);
    for (const banned of ["lastPresenceUpdate}", "last_updated", "minutes ago", "latitude", "longitude"]) {
      expect(rendered, `must not render ${banned}`).not.toContain(banned);
    }
  });

  it("leaves the service worker untouched", () => {
    const worker = read("public/sw.js");
    expect(worker).toContain("network-only-v2");
    expect(worker).not.toMatch(/\bcaches\.(?:open|match|put|delete)\b/);
  });
});
