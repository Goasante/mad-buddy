import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { stripComments } from "@/lib/content/strip-comments";
import {
  upForEndsAtLabel,
  upForLiveState,
  upForSpotsLeft,
  upForViewerAction
} from "@/lib/social/upfor";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const sheet = stripComments(read("components/hangout/upfor-detail-sheet.tsx"));
const page = stripComments(read("components/hangout/hangout-mode-page.tsx"));
const actions = stripComments(read("app/(app)/hangout-actions.ts"));

const NOW = Date.parse("2026-08-08T12:00:00.000Z");
const at = (ms: number) => new Date(NOW + ms).toISOString();

const session = (overrides: Partial<Parameters<typeof upForViewerAction>[0]> = {}) => ({
  ownerId: "owner",
  allowPings: true,
  myRequestStatus: null as string | null,
  endsAt: at(60 * 60_000),
  goingCount: 2,
  maxParticipants: 5,
  ...overrides
});

// ---------------------------------------------------------------------------
// Live state — derived from the server's times, never a client timer
// ---------------------------------------------------------------------------

describe("live state comes from the session, not the clock", () => {
  it("is live inside the window with room", () => {
    expect(upForLiveState(session(), NOW)).toBe("live");
  });

  it("is full once accepted reaches the cap", () => {
    expect(upForLiveState(session({ goingCount: 5, maxParticipants: 5 }), NOW)).toBe("full");
  });

  it("is ended past ends_at, even with space", () => {
    // Expiry wins: a session with room is still over.
    expect(upForLiveState(session({ endsAt: at(-1), goingCount: 1 }), NOW)).toBe("ended");
  });

  it("treats an unparseable date as ended, failing closed", () => {
    expect(upForLiveState(session({ endsAt: "not-a-date" }), NOW)).toBe("ended");
  });

  it("flips to ended as the clock passes ends_at, with the sheet still open", () => {
    const item = session({ endsAt: at(60_000) });
    expect(upForLiveState(item, NOW)).toBe("live");
    // Two minutes later, same row, no refetch.
    expect(upForLiveState(item, NOW + 120_000)).toBe("ended");
  });

  it("derives state on every render rather than storing it", () => {
    // A stored state would go stale exactly when it matters.
    expect(sheet).toContain("upForLiveState(upFor, nowMs)");
  });
});

// ---------------------------------------------------------------------------
// Capacity — no manufactured scarcity
// ---------------------------------------------------------------------------

describe("capacity states only when the numbers produce them", () => {
  it("says 1 spot left only when exactly one remains", () => {
    expect(upForSpotsLeft({ goingCount: 4, maxParticipants: 5 })).toBe(1);
  });

  it("stays quiet when there is plenty of room", () => {
    // "5 spots left" is noise, not information.
    expect(upForSpotsLeft({ goingCount: 0, maxParticipants: 8 })).toBeNull();
  });

  it("stays quiet at full, where the state already says so", () => {
    expect(upForSpotsLeft({ goingCount: 5, maxParticipants: 5 })).toBeNull();
  });

  it("never reports negative spots", () => {
    expect(upForSpotsLeft({ goingCount: 7, maxParticipants: 5 })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Viewer action — one rule set, shared by card and sheet
// ---------------------------------------------------------------------------

describe("the action offered is the one the server would accept", () => {
  it("offers nothing joinable on your own UpFor", () => {
    expect(upForViewerAction(session({ ownerId: "me" }), "me", NOW)).toBe("own");
  });

  it("offers join when live, open and unrequested", () => {
    expect(upForViewerAction(session(), "me", NOW)).toBe("join");
  });

  it("offers cancel while pending", () => {
    expect(upForViewerAction(session({ myRequestStatus: "pending" }), "me", NOW)).toBe("cancel_request");
  });

  it("offers leave once accepted", () => {
    expect(upForViewerAction(session({ myRequestStatus: "accepted" }), "me", NOW)).toBe("leave");
  });

  it("keeps leave available even when full or ended", () => {
    // Someone who joined must always be able to say they are not coming.
    const full = session({ myRequestStatus: "accepted", goingCount: 5, maxParticipants: 5 });
    expect(upForViewerAction(full, "me", NOW)).toBe("leave");
    const over = session({ myRequestStatus: "accepted", endsAt: at(-1) });
    expect(upForViewerAction(over, "me", NOW)).toBe("leave");
  });

  it("offers no join when full, ended, or not taking requests", () => {
    expect(upForViewerAction(session({ goingCount: 5, maxParticipants: 5 }), "me", NOW)).toBe("unavailable");
    expect(upForViewerAction(session({ endsAt: at(-1) }), "me", NOW)).toBe("unavailable");
    expect(upForViewerAction(session({ allowPings: false }), "me", NOW)).toBe("unavailable");
  });

  it("reuses the Stage 3 lifecycle rather than a second join flow", () => {
    expect(page).toContain("onJoin={(id) => requestToJoin(id)}");
    expect(page).toContain("onLeave={(id) => leaveUpFor(id)}");
    expect(sheet).not.toContain("requestHangoutAction");
    expect(sheet).not.toContain("leaveHangoutAction");
  });
});

// ---------------------------------------------------------------------------
// Participants and N+1
// ---------------------------------------------------------------------------

describe("participants are accepted only, loaded without N+1", () => {
  it("counts and lists accepted rows only", () => {
    // Pending, declined and cancelled are absent, so nobody learns who asked
    // and was refused.
    expect(actions).toContain('.eq("status", "accepted")');
  });

  it("batches every participant profile into one read", () => {
    // One query for all participants across all sessions — never one per
    // card, and never one per person.
    expect(actions).toContain("const participantIds = [...new Set(");
    expect(actions).toContain('.in("user_id", participantIds)');
  });

  it("returns public profile fields only", () => {
    expect(actions).toContain('.select("user_id, full_name, username, avatar_url")');
  });

  it("drops a participant whose profile is gone rather than showing a blank", () => {
    expect(actions).toContain("if (!profile) return null;");
  });

  it("gives each avatar a real name for screen readers", () => {
    expect(sheet).toContain("aria-label={participant.displayName}");
  });
});

// ---------------------------------------------------------------------------
// Privacy
// ---------------------------------------------------------------------------

describe("the sheet reveals nothing it should not", () => {
  it("never shows pending or declined requester identities", () => {
    // Only `participants` is rendered, and the projection fills it from
    // accepted rows alone. Matched as request STATUS strings — the bare word
    // "pending" is also the in-flight prop, which is unrelated.
    expect(sheet).not.toContain('"pending"');
    expect(sheet).not.toContain('"declined"');
    expect(sheet).toContain("upFor.participants");
  });

  it("shows the broad area only, never a coordinate or distance", () => {
    // Via the shared formatter, so card and sheet cannot disagree.
    expect(sheet).toContain("upForPlaceLabel(upFor)");
    for (const absent of ["latitude", "longitude", "km away", "address", "distance"]) {
      expect(sheet).not.toContain(absent);
    }
  });

  it("hides the area row entirely when there is none", () => {
    // Rather than an empty row implying missing data.
    expect(sheet).toContain("{upForPlaceLabel(upFor) ? (");
  });

  it("never names a block, ghost mode or an audience target", () => {
    for (const absent of ["blocked", "ghost", "audience_target", "audienceType"]) {
      expect(sheet).not.toContain(absent);
    }
  });

  it("closes without explanation when the row disappears", () => {
    // Access lost or session expired: the sheet simply has nothing to show,
    // and says nothing about why.
    expect(page).toContain("feed.find((item) => item.id === detailId) ?? null");
  });
});

// ---------------------------------------------------------------------------
// Entry point, state and edges
// ---------------------------------------------------------------------------

describe("opening and closing", () => {
  it("opens from the card body, with no redundant View button", () => {
    /* The card moved to its own component; the property did not. The card
     * BODY is still the target -- a separate "View" button beside a tappable
     * card is one more thing to aim at -- and the page still supplies the
     * opener, so the sheet keeps re-reading the live row by id. */
    const card = stripComments(read("components/hangout/upfor-card.tsx"));
    expect(card).toContain("onClick: () => onOpen(upfor.id)");
    expect(card).not.toContain(">View<");
    expect(page).toContain("onOpen={(id) => setDetailId(id)}");
    expect(page).not.toContain(">View<");
  });

  it("holds an id, so the sheet re-reads the live row", () => {
    // Holding the object would freeze a copy that drifts from the list.
    expect(page).toContain("const [detailId, setDetailId] = useState<string | null>(null)");
  });

  it("uses the canonical sheet, which already handles Back, Escape and focus", () => {
    expect(sheet).toContain('variant="sheet"');
    expect(sheet).toContain("<Modal");
    const modal = read("components/ui/modal.tsx");
    expect(modal).toContain("useDismissOnBack");
  });

  it("gives the dialog an accessible title and description", () => {
    expect(sheet).toContain("title={upFor ? upForTitle(upFor.activityType)");
    expect(sheet).toContain("description={upFor ?");
  });

  it("announces the countdown politely, not assertively", () => {
    // An assertive countdown would re-interrupt every minute.
    expect(sheet).toContain('aria-live="polite"');
  });

  it("hides the message row when there is none", () => {
    expect(sheet).toContain("{upFor.message ?");
  });

  it("hides the participant list when nobody else is coming", () => {
    expect(sheet).toContain("upFor.participants.length > 0");
  });
});

describe("the owner sees owner controls", () => {
  it("offers ending rather than joining", () => {
    expect(sheet).toContain("End UpFor");
    expect(sheet).toContain('action === "own"');
  });

  it("reuses the existing end action rather than inventing one", () => {
    expect(page).toContain("turnOff();");
  });

  it("points at the existing request management rather than duplicating it", () => {
    // Approval logic stays in one place.
    expect(sheet).toContain("requests to join");
    expect(sheet).not.toContain("respondHangoutRequestAction");
  });
});

describe("time formatting", () => {
  it("gives a fixed clock time alongside the countdown", () => {
    expect(upForEndsAtLabel(at(90 * 60_000))).toMatch(/\d/);
  });

  it("returns null for an unparseable date rather than NaN", () => {
    expect(upForEndsAtLabel("not-a-date")).toBeNull();
  });
});
