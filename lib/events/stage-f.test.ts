import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { stripComments } from "@/lib/content/strip-comments";
import {
  canPublishEvent,
  checkCoverAsset,
  clampFocal,
  coverDimensionError,
  coverRejectionMessage,
  focalObjectPosition,
  isPublishedStatus,
  type CoverAssetFacts
} from "@/lib/events/cover";
import {
  ARRIVAL_SNOOZE_MS,
  NOT_YET_EFFECTS,
  arrivalSnoozeUntilMs,
  resolveArrivalPrompt,
  type ArrivalPromptInput
} from "@/lib/events/arrival";
import {
  EVENT_MODE_INITIAL_TIER,
  canEnterEventMode,
  eventModeHref,
  narrowToEventMode,
  readEventModeContext
} from "@/lib/social/event-mode";
import { resolveEventMedia } from "@/lib/events/event-media";

/**
 * Stage F: cover media, arrival, and Linkr Event Mode.
 *
 * The rule layers are pure, so these are real behavioural tests. The server
 * action and surface assertions at the bottom are source-text, the pattern
 * this codebase uses for server-only paths (vitest runs environment: "node").
 */

const HOST = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const EVENT_ID = "33333333-3333-4333-8333-333333333333";
const NOW = Date.parse("2026-08-12T20:00:00.000Z");

const asset = (overrides: Partial<CoverAssetFacts> = {}): CoverAssetFacts => ({
  ownerId: HOST,
  contextType: "event",
  processingStatus: "ready",
  moderationStatus: "active",
  deletedAt: null,
  ...overrides
});

// ---------------------------------------------------------------------------
// PART A — cover media
// ---------------------------------------------------------------------------

describe("cover asset validity", () => {
  it("accepts an owned, ready, active event asset", () => {
    expect(checkCoverAsset(asset(), HOST)).toEqual({ ok: true });
  });

  it("rejects someone else's asset", () => {
    // Otherwise a client could send any asset id and display it on their event.
    expect(checkCoverAsset(asset({ ownerId: OTHER }), HOST)).toEqual({
      ok: false,
      reason: "not_owned"
    });
  });

  it("rejects an asset from another context", () => {
    // A chat attachment must not become a public event cover.
    expect(checkCoverAsset(asset({ contextType: "chat" }), HOST)).toEqual({
      ok: false,
      reason: "wrong_context"
    });
  });

  it("rejects moderated or deleted artwork", () => {
    for (const status of ["under_review", "restricted", "removed"]) {
      expect(checkCoverAsset(asset({ moderationStatus: status }), HOST), status).toEqual({
        ok: false,
        reason: "moderated"
      });
    }
    expect(checkCoverAsset(asset({ deletedAt: NOW.toString() }), HOST).ok).toBe(false);
  });

  it("rejects an asset that has not finished processing", () => {
    expect(checkCoverAsset(asset({ processingStatus: "pending" }), HOST)).toEqual({
      ok: false,
      reason: "not_ready"
    });
  });

  it("explains every rejection in words a creator can act on", () => {
    for (const reason of ["missing", "not_owned", "wrong_context", "not_ready", "moderated", "deleted"] as const) {
      const message = coverRejectionMessage(reason);
      expect(message.length, reason).toBeGreaterThan(0);
      expect(message, reason).not.toMatch(/error|failed|invalid/i);
    }
    // The exact copy the brief asks for on the missing case (§36).
    expect(coverRejectionMessage("missing")).toBe("Add an Event cover image before publishing.");
  });
});

describe("the publish rule is about the transition, not every row", () => {
  it("lets a draft exist with no cover", () => {
    expect(canPublishEvent({ targetStatus: "draft", cover: { ok: false, reason: "missing" } })).toEqual({
      ok: true
    });
  });

  it("refuses to publish without a cover", () => {
    expect(canPublishEvent({ targetStatus: "scheduled", cover: { ok: false, reason: "missing" } })).toEqual({
      ok: false,
      reason: "missing"
    });
  });

  it("allows publish once a valid cover exists", () => {
    expect(
      canPublishEvent({ targetStatus: "scheduled", cover: checkCoverAsset(asset(), HOST) })
    ).toEqual({ ok: true });
  });

  it("treats scheduled and active as published", () => {
    expect(isPublishedStatus("scheduled")).toBe(true);
    expect(isPublishedStatus("active")).toBe(true);
    expect(isPublishedStatus("draft")).toBe(false);
  });
});

describe("legacy events keep working", () => {
  it("falls back to generated artwork when there is no cover", () => {
    expect(resolveEventMedia(EVENT_ID, null).kind).toBe("fallback");
  });

  it("uses the real cover when one exists", () => {
    expect(resolveEventMedia(EVENT_ID, "https://example.test/a.jpg")).toEqual({
      kind: "image",
      url: "https://example.test/a.jpg"
    });
  });

  it("never reaches for an external stock image", () => {
    const media = stripComments(read("lib/events/event-media.ts"));
    expect(media).not.toContain("picsum");
    expect(media).not.toMatch(/https?:\/\//);
  });
});

describe("focal point", () => {
  it("defaults to the centre", () => {
    expect(focalObjectPosition(0.5, 0.5)).toBe("50% 50%");
  });

  it("clamps anything out of range or unusable", () => {
    for (const bad of [NaN, Infinity, -1, 2, "x", null, undefined]) {
      const value = clampFocal(bad);
      expect(value, String(bad)).toBeGreaterThanOrEqual(0);
      expect(value, String(bad)).toBeLessThanOrEqual(1);
    }
  });

  it("rejects an image too small to look sharp", () => {
    expect(coverDimensionError(400, 500)).not.toBeNull();
    expect(coverDimensionError(1200, 1500)).toBeNull();
  });

  /**
   * THE BUG THIS GUARDS. The rule was `width >= 600 && height >= 750`, which
   * demands each edge independently -- and because 750 > 600 it quietly
   * required a PORTRAIT image. A 1600x720 screenshot is 1.15 megapixels and
   * was refused as "too small to look sharp". Nothing was small about it.
   */
  it("accepts real photographs whatever their orientation", () => {
    for (const [width, height, label] of [
      [4032, 3024, "landscape phone"],
      [3024, 4032, "portrait phone"],
      [1920, 1080, "16:9"],
      [1080, 1920, "9:16"],
      [1080, 1080, "square"],
      [1600, 720, "wide screenshot"]
    ] as Array<[number, number, string]>) {
      expect(coverDimensionError(width, height), `${label} ${width}x${height}`).toBeNull();
    }
  });

  it("still refuses images that genuinely cannot render sharply", () => {
    // Below the area floor, whatever their shape.
    expect(coverDimensionError(800, 600)).not.toBeNull();
    expect(coverDimensionError(1024, 640)).not.toBeNull();
  });

  it("refuses a long thin sliver even when its area passes", () => {
    // 4000x500 is 2 MEGAPIXELS -- comfortably past the area floor -- but its
    // 500px short edge cannot fill a card. Only the short-edge rule catches
    // this, so it must be tested with a shape the area rule would allow.
    expect(coverDimensionError(4000, 500)).not.toBeNull();
    expect(coverDimensionError(500, 4000)).not.toBeNull();
  });

  it("treats unreadable dimensions as a read failure, not a size failure", () => {
    for (const [width, height] of [[0, 1000], [-5, 900], [Number.NaN, 900]]) {
      expect(coverDimensionError(width, height)).toContain("couldn't be read");
    }
  });

  it("does not decide by orientation", () => {
    // The same pixel count must pass or fail identically either way round.
    expect(coverDimensionError(1600, 720)).toBe(coverDimensionError(720, 1600));
    expect(coverDimensionError(800, 600)).toBe(coverDimensionError(600, 800));
  });
});

// ---------------------------------------------------------------------------
// PART B — arrival
// ---------------------------------------------------------------------------

const arrival = (overrides: Partial<ArrivalPromptInput> = {}): ArrivalPromptInput => ({
  myRsvp: "going",
  isHost: false,
  checkInWindowOpen: true,
  alreadyCheckedIn: false,
  accessDenied: false,
  snoozedUntilMs: null,
  nowMs: NOW,
  ...overrides
});

describe("the arrival prompt", () => {
  it("shows for a Going user once the check-in window opens", () => {
    expect(resolveArrivalPrompt(arrival())).toEqual({ visible: true, reason: "visible" });
  });

  it("does not ask someone who only said Interested", () => {
    expect(resolveArrivalPrompt(arrival({ myRsvp: "interested" })).visible).toBe(false);
  });

  it("does not ask someone who said Not Going", () => {
    expect(resolveArrivalPrompt(arrival({ myRsvp: "not_going" }))).toEqual({
      visible: false,
      reason: "not_going"
    });
  });

  it("does not ask someone who never RSVP'd", () => {
    expect(resolveArrivalPrompt(arrival({ myRsvp: null })).visible).toBe(false);
  });

  it("asks the host without needing them to RSVP to their own event", () => {
    expect(resolveArrivalPrompt(arrival({ myRsvp: null, isHost: true })).visible).toBe(true);
  });

  it("does not ask before the check-in window opens", () => {
    expect(resolveArrivalPrompt(arrival({ checkInWindowOpen: false }))).toEqual({
      visible: false,
      reason: "window_closed"
    });
  });

  it("does not ask someone already checked in", () => {
    expect(resolveArrivalPrompt(arrival({ alreadyCheckedIn: true }))).toEqual({
      visible: false,
      reason: "already_checked_in"
    });
  });

  it("tells a blocked or ineligible viewer nothing", () => {
    // access_denied outranks every other reason, including "going".
    expect(resolveArrivalPrompt(arrival({ accessDenied: true, myRsvp: "going" }))).toEqual({
      visible: false,
      reason: "access_denied"
    });
  });
});

describe("Not yet", () => {
  it("suppresses the prompt for a bounded period, then allows it again", () => {
    const until = arrivalSnoozeUntilMs(NOW);
    expect(resolveArrivalPrompt(arrival({ snoozedUntilMs: until })).visible).toBe(false);
    // Later in the same event, arrival is offered once more -- not never again.
    expect(
      resolveArrivalPrompt(arrival({ snoozedUntilMs: until, nowMs: until + 1000 })).visible
    ).toBe(true);
  });

  it("does not nag every few minutes", () => {
    expect(ARRIVAL_SNOOZE_MS).toBeGreaterThanOrEqual(30 * 60 * 1000);
  });

  it("changes nothing else about the user's state", () => {
    // Dismissing must never become a decline.
    expect(NOT_YET_EFFECTS).toEqual({
      changesRsvp: false,
      marksNotGoing: false,
      checksIn: false,
      enablesEventGlow: false,
      permanentlySuppresses: false
    });
  });
});

describe("arrival adds no notification", () => {
  it("schedules nothing and reuses Stage D's reminders", () => {
    const source = stripComments(read("lib/events/arrival.ts"));
    for (const scheduler of ["deliverNotification", "enqueueJob", "jobs", "push"]) {
      expect(source, scheduler).not.toContain(scheduler);
    }
  });

  it("leaves the Stage D reminder stages untouched", () => {
    const rules = stripComments(read("lib/reminders/rules.ts"));
    expect(rules).toContain("near_start");
    // No new stage was added at event start.
    expect(rules).not.toContain("at_start");
    expect(rules).not.toContain("arrival");
  });
});

// ---------------------------------------------------------------------------
// PART B — Linkr Event Mode
// ---------------------------------------------------------------------------

describe("Linkr Event Mode is a per-request context", () => {
  it("opens at the closest tier", () => {
    expect(EVENT_MODE_INITIAL_TIER).toBe("close");
    expect(readEventModeContext({ eventMode: "1", eventId: EVENT_ID })).toEqual({
      eventId: EVENT_ID,
      initialTier: "close"
    });
  });

  it("is absent unless explicitly requested", () => {
    expect(readEventModeContext({ eventMode: null, eventId: EVENT_ID })).toBeNull();
    expect(readEventModeContext({ eventMode: "1", eventId: null })).toBeNull();
  });

  it("refuses a malformed event id rather than trusting it", () => {
    expect(readEventModeContext({ eventMode: "1", eventId: "not-a-uuid" })).toBeNull();
    expect(readEventModeContext({ eventMode: "1", eventId: "' or 1=1--" })).toBeNull();
  });

  it("builds a link that round-trips", () => {
    const href = eventModeHref(EVENT_ID);
    const params = new URLSearchParams(href.split("?")[1]);
    expect(readEventModeContext({ eventMode: params.get("eventMode"), eventId: params.get("eventId") })).toEqual({
      eventId: EVENT_ID,
      initialTier: "close"
    });
  });

  it("stores no preference anywhere", () => {
    // There is no persisted proximity setting in Linkr, and Event Mode must
    // not invent one. No table write, no settings update.
    const source = stripComments(read("lib/social/event-mode.ts"));
    for (const term of ["supabase", "update(", "insert(", "localStorage"]) {
      expect(source, term).not.toContain(term);
    }
  });
});

describe("Event Mode narrows, never widens", () => {
  const candidates = [
    { id: "a", proximityTier: "close" as const },
    { id: "b", proximityTier: "near" as const },
    { id: "c", proximityTier: "far" as const }
  ];

  it("shows only the closest people at the event", () => {
    expect(narrowToEventMode(candidates, "close").map((c) => c.id)).toEqual(["a"]);
  });

  it("can only ever remove candidates", () => {
    for (const tier of ["close", "near", "far"] as const) {
      const result = narrowToEventMode(candidates, tier);
      expect(result.length, tier).toBeLessThanOrEqual(candidates.length);
      for (const person of result) expect(candidates).toContainEqual(person);
    }
  });

  it("requires a live check-in, not merely an RSVP", () => {
    expect(canEnterEventMode({ viewerCheckedIn: true, eventActive: true, accessDenied: false })).toBe(true);
    expect(canEnterEventMode({ viewerCheckedIn: false, eventActive: true, accessDenied: false })).toBe(false);
  });

  it("refuses a finished event or a blocked viewer", () => {
    expect(canEnterEventMode({ viewerCheckedIn: true, eventActive: false, accessDenied: false })).toBe(false);
    expect(canEnterEventMode({ viewerCheckedIn: true, eventActive: true, accessDenied: true })).toBe(false);
  });
});

describe("checking in does not make anyone discoverable", () => {
  it("leaves the canonical stranger gate untouched", () => {
    const gate = stripComments(read("lib/social/upfor-discovery.ts"));
    // Event Mode must not have added an event bypass into the gate itself.
    expect(gate).not.toContain("eventId");
    expect(gate).not.toContain("checkedIn");
    // The opt-in remains the first thing the gate checks.
    expect(gate).toContain('input.discoveryScope !== "nearby"');
  });

  it("keeps check-in free of discovery side effects", () => {
    const checkIn = stripComments(read("app/(app)/event-actions.ts"));
    expect(checkIn).not.toContain("discoveryScope");
    expect(checkIn).not.toContain("eventMode");
  });
});

// ---------------------------------------------------------------------------
// Server-authoritative wiring (source-text: server-only paths)
// ---------------------------------------------------------------------------

function read(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

const coverActions = stripComments(read("app/(app)/event-cover-actions.ts"));

describe("the cover upload reuses the canonical media pipeline", () => {
  it("validates magic bytes rather than the filename", () => {
    expect(coverActions).toContain("validateImageUpload");
    expect(coverActions).toContain("headerBytes");
  });

  it("strips EXIF before anything reaches storage", () => {
    expect(coverActions).toContain("processImageUpload");
  });

  it("writes through media_assets, not a second table", () => {
    expect(coverActions).toContain('from("media_assets")');
    expect(coverActions).toContain('context_type: "event"');
    expect(coverActions).toContain("media_variants");
  });

  it("only the host may set a cover", () => {
    expect(coverActions).toContain("event.host_id !== userId");
  });

  it("enforces the publish rule server-side, not only in the UI", () => {
    expect(coverActions).toContain("canPublishEvent");
    expect(coverActions).toContain("checkCoverAsset");
  });

  it("re-reads the asset at publish rather than trusting the pointer", () => {
    // The asset could have been moderated between upload and publish.
    const publish = coverActions.slice(coverActions.indexOf("export async function publishEventAction"));
    expect(publish).toContain('from("media_assets")');
  });
});

describe("replacement preserves the old artwork until the new one is ready", () => {
  it("moves the event pointer only after the new asset is ready", () => {
    const bindIndex = coverActions.indexOf('.update({ cover_media_id: asset.id');
    const readyIndex = coverActions.indexOf('processing_status: "ready"');
    expect(readyIndex).toBeGreaterThan(-1);
    expect(bindIndex).toBeGreaterThan(readyIndex);
  });

  it("rolls back the new upload on failure rather than the old cover", () => {
    expect(coverActions).toContain("removeFailedUpload");
    const bind = coverActions.slice(coverActions.indexOf("const previousCoverId"));
    expect(bind).toContain("previousCoverId");
  });

  it("soft-deletes the replaced asset for the canonical cleanup path", () => {
    expect(coverActions).toContain("deleted_at: new Date().toISOString()");
  });
});

describe("every ranked surface resolves one canonical cover", () => {
  const projection = stripComments(read("lib/events/ranked-events.ts"));

  it("reads the cover and focal point from the event row", () => {
    expect(projection).toContain("cover_media_id");
    expect(projection).toContain("cover_focal_x");
  });

  it("signs covers in one batch rather than per event", () => {
    expect(projection).toContain("signMediaForAsset");
    expect(projection).toContain("coverIds.map");
  });

  it("gives the accordion and the list the same focal point", () => {
    for (const path of [
      "components/events/ranked-events-accordion.tsx",
      "components/events/top-events-list.tsx"
    ]) {
      expect(stripComments(read(path)), path).toContain("focalObjectPosition(event.focalPoint.x");
    }
  });
});
