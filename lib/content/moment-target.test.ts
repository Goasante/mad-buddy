import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  MOMENT_PARAM,
  UNAVAILABLE_MESSAGE,
  momentAnchorId,
  momentHref,
  parseMomentParam,
  resolveMomentTarget,
  rotateSequenceToTarget,
  urlWithoutMomentParam
} from "@/lib/content/moment-target";
import { stripComments } from "@/lib/content/strip-comments";
import type { VisibleMoment } from "@/lib/content/service";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const NOW = Date.UTC(2026, 7, 6, 12, 0, 0);
const MIN = 60_000;

const ID_A = "11111111-1111-4111-8111-111111111111";
const ID_B = "22222222-2222-4222-8222-222222222222";
const ID_C = "33333333-3333-4333-8333-333333333333";

function moment(overrides: Partial<VisibleMoment> & { id: string }): VisibleMoment {
  return {
    authorId: `author-${overrides.id}`,
    authorName: "A Muddy",
    authorAvatarUrl: null,
    authorPlan: "free",
    contentType: "photo",
    textContent: null,
    caption: null,
    mediaUrl: null,
    expiresAt: new Date(NOW + 60 * MIN).toISOString(),
    createdAt: new Date(NOW - 10 * MIN).toISOString(),
    myReaction: null,
    reactionCount: 0,
    reactionBreakdown: {},
    isAuthor: false,
    audienceLabel: null,
    viewerRelationship: "muddy",
    viewCount: 0,
    tunedInFromThis: null,
    creatorTunedIn: false,
    creatorTunedInCount: 0,
    ...overrides
  };
}

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

describe("moment identity", () => {
  it("accepts a well-formed id", () => {
    expect(parseMomentParam(ID_A)).toBe(ID_A);
    expect(parseMomentParam(` ${ID_A.toUpperCase()} `)).toBe(ID_A);
  });

  it("rejects anything that is not an id", () => {
    for (const bad of [null, undefined, "", "  ", "3", "0", "abc", "../../etc", "<script>"]) {
      expect(parseMomentParam(bad), `must reject ${String(bad)}`).toBeNull();
    }
  });

  it("never uses list position as identity", () => {
    // A numeric index must not be accepted as a target — order changes, ids do
    // not, and an index would point at a different Moment after any refresh.
    expect(parseMomentParam("0")).toBeNull();
    expect(parseMomentParam("2")).toBeNull();
    const source = stripComments(read("lib/content/moment-target.ts"));
    expect(source).not.toContain("parseInt");
    expect(source).not.toContain("Number(");
  });
});

// ---------------------------------------------------------------------------
// Links
// ---------------------------------------------------------------------------

describe("exact-Moment links", () => {
  it("links a Moment to its own id on the Moments tab", () => {
    expect(momentHref(ID_A, "moments")).toBe(`/moments?tab=moments&${MOMENT_PARAM}=${ID_A}`);
  });

  it("links an Air item to its own id on the Air tab", () => {
    expect(momentHref(ID_B, "air")).toBe(`/moments?tab=air&${MOMENT_PARAM}=${ID_B}`);
  });

  it("gives every card a distinct destination", () => {
    const hrefs = [momentHref(ID_A, "moments"), momentHref(ID_B, "moments"), momentHref(ID_C, "air")];
    expect(new Set(hrefs).size).toBe(3);
  });

  it("is used by the shared tile, so Home and the Moments page both target exactly", () => {
    const tile = read("components/content/moment-tile.tsx");
    expect(tile).toContain('momentHref(moment.id, air ? "air" : "moments")');
    // The old generic destinations are gone.
    expect(stripComments(tile)).not.toContain('"/moments?tab=moments"');
    expect(stripComments(tile)).not.toContain('"/moments?tab=air"');
  });
});

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

describe("target resolution", () => {
  const feed = [moment({ id: ID_A }), moment({ id: ID_B }), moment({ id: ID_C })];

  it("finds the exact Moment and reports its position", () => {
    const result = resolveMomentTarget(ID_B, feed, { nowMs: NOW });
    expect(result.status).toBe("found");
    if (result.status !== "found") return;
    expect(result.moment.id).toBe(ID_B);
    expect(result.index).toBe(1);
  });

  it("leaves the feed order completely unchanged", () => {
    const before = feed.map((m) => m.id);
    resolveMomentTarget(ID_C, feed, { nowMs: NOW });
    expect(feed.map((m) => m.id)).toEqual(before);
    // The target is located, never moved to the front.
    const source = stripComments(read("lib/content/moment-target.ts"));
    expect(source).not.toContain(".sort(");
    expect(source).not.toContain(".unshift(");
    expect(source).not.toContain(".reverse(");
  });

  it("renders the normal page when no target is requested", () => {
    expect(resolveMomentTarget(null, feed, { nowMs: NOW }).status).toBe("none");
    expect(resolveMomentTarget("", feed, { nowMs: NOW }).status).toBe("none");
  });

  it("ignores a malformed id safely", () => {
    // Not an error and not a lookup: it simply is not a target.
    expect(resolveMomentTarget("not-an-id", feed, { nowMs: NOW }).status).toBe("none");
  });

  it("refuses an expired target", () => {
    const expired = moment({ id: ID_A, expiresAt: new Date(NOW - MIN).toISOString() });
    const result = resolveMomentTarget(ID_A, [expired], { nowMs: NOW });
    expect(result.status).toBe("unavailable");
  });

  it("refuses a target that is not in the viewer's authorised feed", () => {
    // An id the viewer cannot see never appears in the feed, so it cannot
    // resolve. This is the unauthorised case.
    const result = resolveMomentTarget(ID_A, [moment({ id: ID_B })], { nowMs: NOW });
    expect(result.status).toBe("unavailable");
  });

  it("refuses a target that belongs to the other tab", () => {
    // The Air feed does not contain a private Moment, so targeting one from
    // the Air tab resolves to unavailable rather than leaking it.
    const airFeed = [moment({ id: ID_C })];
    expect(resolveMomentTarget(ID_A, airFeed, { nowMs: NOW }).status).toBe("unavailable");
  });
});

// ---------------------------------------------------------------------------
// Privacy
// ---------------------------------------------------------------------------

describe("privacy of the failure path", () => {
  it("gives one identical message for every reason", () => {
    const expired = resolveMomentTarget(ID_A, [moment({ id: ID_A, expiresAt: new Date(NOW - MIN).toISOString() })], {
      nowMs: NOW
    });
    const unauthorised = resolveMomentTarget(ID_A, [moment({ id: ID_B })], { nowMs: NOW });
    const missing = resolveMomentTarget(ID_C, [], { nowMs: NOW });

    // Identical copy, so the response cannot be used to probe whether an id
    // exists or why it was refused.
    for (const result of [expired, unauthorised, missing]) {
      expect(result.status).toBe("unavailable");
      if (result.status !== "unavailable") continue;
      expect(result.message).toBe(UNAVAILABLE_MESSAGE);
    }
  });

  it("never says why", () => {
    for (const banned of ["expired", "deleted", "blocked", "not allowed", "permission", "private"]) {
      expect(UNAVAILABLE_MESSAGE.toLowerCase()).not.toContain(banned);
    }
  });

  it("resolves only against an already-authorised feed", () => {
    const source = stripComments(read("lib/content/moment-target.ts"));
    for (const banned of ["createSupabase", "fetch(", "from(", "admin"]) {
      expect(source, `must not use ${banned}`).not.toContain(banned);
    }
  });
});

// ---------------------------------------------------------------------------
// Page wiring
// ---------------------------------------------------------------------------

describe("Moments page wiring", () => {
  const page = read("components/content/moments-page.tsx");

  it("anchors every card so the exact target can be reached", () => {
    expect(page).toContain("id={momentAnchorId(moment.id)}");
    expect(momentAnchorId(ID_A)).toBe(`moment-${ID_A}`);
  });

  it("brings the target into view rather than reordering the feed", () => {
    expect(page).toContain("scrollIntoView");
    expect(page).toContain('block: "center"');
  });

  it("honours reduced motion when scrolling to the target", () => {
    expect(page).toContain('window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth"');
  });

  it("consumes a target once instead of re-scrolling on every render", () => {
    expect(page).toContain("consumedTargetRef");
  });

  it("clears the parameter with replace, not push", () => {
    expect(page).toContain("router.replace(urlWithoutMomentParam(tab)");
    expect(urlWithoutMomentParam("air")).toBe("/moments?tab=air");
  });

  it("announces an unavailable target to screen readers", () => {
    expect(page).toContain('role="status"');
    expect(page).toContain("{targetNotice}");
  });

  it("resolves the target during render rather than syncing it into state", () => {
    // Derived from the URL and the authorised feed, so there is no second
    // source of truth to fall out of step.
    expect(page).toContain("resolveMomentTarget(momentParam, liveFeed");
    expect(page).not.toContain("setTargetNotice");
  });
});

// ---------------------------------------------------------------------------
// Full-screen media layer
// ---------------------------------------------------------------------------

describe("full-screen media layer", () => {
  const viewer = read("components/content/moment-media-viewer.tsx");
  const page = read("components/content/moments-page.tsx");
  const parts = read("components/content/moment-parts.tsx");

  it("opens from the Moment the viewer tapped", () => {
    expect(parts).toContain("onOpenFullScreen");
    expect(page).toContain("onOpenFullScreen={() => openFullScreen(moment)}");
  });

  it("is not a second feed", () => {
    // One Moment, no next/previous, no loading of its own.
    expect(viewer).toContain("moment: VisibleMoment;");
    expect(stripComments(viewer)).not.toContain("moments:");
    for (const banned of ["getMomentFeedAction", "getOpenMomentFeedAction", "buildMomentFeed"]) {
      expect(viewer, `must not load a feed (${banned})`).not.toContain(banned);
    }
  });

  it("fits the whole image rather than cropping it", () => {
    expect(viewer).toContain("object-contain");
    expect(viewer).not.toContain("object-cover");
  });

  it("uses a dark backdrop", () => {
    expect(viewer).toContain("rgba(0,0,0,");
  });

  it("dismisses by swipe-down past a threshold, and springs back below it", () => {
    expect(viewer).toContain("DISMISS_THRESHOLD");
    expect(viewer).toContain("DISMISS_VELOCITY");
    expect(viewer).toContain("if (far || fast) dismiss();");
    expect(viewer).toContain("else setDragY(0);");
  });

  it("moves the media with the finger and fades the backdrop", () => {
    expect(viewer).toContain("translateY(${dragY}px)");
    expect(viewer).toContain("backdropOpacity");
  });

  it("ignores upward drags so it cannot fight page scroll", () => {
    expect(viewer).toContain("setDragY(deltaY > 0 ? deltaY : 0)");
  });

  it("disables swipe-to-dismiss while zoomed", () => {
    // Otherwise panning a zoomed photo would dismiss by accident.
    expect(viewer).toContain("if (zoomed || isVideo) return;");
  });

  it("closes by button, Escape and Back", () => {
    expect(viewer).toContain('aria-label="Close full screen"');
    expect(viewer).toContain('event.key === "Escape"');
    // Hardware/browser Back reuses the shared sheet-dismissal hook, so the
    // back sequence is full-screen → Moment → page.
    expect(viewer).toContain("useDismissOnBack(open, dismiss)");
  });

  it("traps focus while open and restores it on the way out", () => {
    expect(viewer).toContain('event.key !== "Tab"');
    expect(viewer).toContain("returnFocusRef.current?.focus?.()");
  });

  it("respects reduced motion", () => {
    expect(viewer).toContain("useReducedMotion()");
    expect(viewer).toContain('dragging || reducedMotion ? "none"');
  });

  it("labels the media for assistive tech", () => {
    expect(viewer).toContain('aria-modal="true"');
    // Labels follow the ACTIVE item as the sequence advances.
    expect(viewer).toContain("active.caption?.trim() || `Moment from ${active.authorName}`");
  });
});

// ---------------------------------------------------------------------------
// Return state and performance
// ---------------------------------------------------------------------------

describe("return state", () => {
  const viewer = read("components/content/moment-media-viewer.tsx");
  const page = read("components/content/moments-page.tsx");

  it("resumes video rather than restarting it", () => {
    expect(viewer).toContain("initialVideoTime");
    expect(viewer).toContain("videoRef.current.currentTime = initialVideoTime");
    // The position is handed back so the card resumes too.
    expect(viewer).toContain("onVideoTimeChange?.(videoRef.current.currentTime)");
    expect(page).toContain("videoPositions.current.set");
  });

  it("closes the layer without remounting the page or resetting the feed", () => {
    // Closing only clears the overlay's own state.
    expect(page).toContain("setFullScreenFor(null)");
    expect(page).not.toContain("router.refresh();\n            setFullScreenFor");
  });

  it("keeps the page from scrolling underneath the layer", () => {
    expect(viewer).toContain('document.body.style.overflow = "hidden"');
    expect(viewer).toContain("document.body.style.overflow = previousOverflow");
  });
});

describe("media performance", () => {
  const page = read("components/content/moments-page.tsx");
  const actions = read("app/(app)/moments-actions.ts");

  it("loads the large asset only when full-screen opens", () => {
    expect(page).toContain("getMomentFullMediaUrlAction(moment.id)");
    // Cards still ship the feed-sized variant.
    expect(read("lib/content/service.ts")).toContain('signMediaForAsset(admin, moment.media_id, "feed")');
  });

  it("does not fetch the feed again to open a Moment", () => {
    const opener = page.slice(page.indexOf("function openFullScreen"), page.indexOf("function refreshFeeds"));
    expect(opener).not.toContain("getMomentFeedAction");
    expect(opener).not.toContain("getOpenMomentFeedAction");
    expect(opener).not.toContain("router.refresh");
  });

  it("authorises the full-size URL with the same canonical gate", () => {
    const action = actions.slice(actions.indexOf("export async function getMomentFullMediaUrlAction"));
    expect(action).toContain("canViewMoment(admin, userId, momentId)");
    // Refuses expired media even to someone who could see it before.
    expect(action).toContain("Date.parse(moment.expires_at) <= Date.now()");
    // Same null answer for forbidden and missing.
    expect(action).not.toContain("throw new Error");
  });
});

// ---------------------------------------------------------------------------
// Viewer sequence rotation
// ---------------------------------------------------------------------------

describe("viewer sequence rotation", () => {
  const ID_D = "44444444-4444-4444-8444-444444444444";
  // A, B, C, D in canonical feed order.
  const feed = [moment({ id: ID_A }), moment({ id: ID_B }), moment({ id: ID_C }), moment({ id: ID_D })];
  const ids = (list: VisibleMoment[]) => list.map((m) => m.id);

  it("keeps a selected FIRST item first", () => {
    expect(ids(rotateSequenceToTarget(feed, ID_A))).toEqual([ID_A, ID_B, ID_C, ID_D]);
  });

  it("rotates a selected MIDDLE item to the front", () => {
    // The brief's worked example: tapping C gives C, D, A, B.
    expect(ids(rotateSequenceToTarget(feed, ID_C))).toEqual([ID_C, ID_D, ID_A, ID_B]);
  });

  it("rotates a selected LAST item to the front", () => {
    expect(ids(rotateSequenceToTarget(feed, ID_D))).toEqual([ID_D, ID_A, ID_B, ID_C]);
  });

  it("continues circularly rather than reordering", () => {
    // Every neighbour relationship from the canonical order survives: the
    // sequence is started from a different point, not re-sorted.
    const rotated = ids(rotateSequenceToTarget(feed, ID_C));
    const canonical = ids(feed);
    for (let i = 0; i < rotated.length; i += 1) {
      const here = canonical.indexOf(rotated[i]!);
      const next = canonical.indexOf(rotated[(i + 1) % rotated.length]!);
      expect(next).toBe((here + 1) % canonical.length);
    }
  });

  it("never duplicates or drops a Moment", () => {
    const rotated = ids(rotateSequenceToTarget(feed, ID_C));
    expect(rotated).toHaveLength(feed.length);
    expect(new Set(rotated).size).toBe(feed.length);
    expect([...rotated].sort()).toEqual([...ids(feed)].sort());
  });

  it("leaves the canonical feed untouched", () => {
    const before = ids(feed);
    rotateSequenceToTarget(feed, ID_C);
    expect(ids(feed)).toEqual(before);
  });

  it("falls back to the normal order for an invalid or unknown target", () => {
    for (const bad of [null, undefined, "", "not-an-id", ID_A.replace("1", "9")]) {
      expect(ids(rotateSequenceToTarget(feed, bad))).toEqual(ids(feed));
    }
  });

  it("handles an empty or single-item sequence", () => {
    expect(rotateSequenceToTarget([], ID_A)).toEqual([]);
    expect(ids(rotateSequenceToTarget([moment({ id: ID_A })], ID_A))).toEqual([ID_A]);
  });

  it("applies the same rule to Air", () => {
    // Air items are the same VisibleMoment shape on the same sequence, so the
    // rule is shared rather than duplicated for Air.
    const air = [moment({ id: ID_A }), moment({ id: ID_B }), moment({ id: ID_C })];
    expect(ids(rotateSequenceToTarget(air, ID_B))).toEqual([ID_B, ID_C, ID_A]);
  });

  it("sorts nothing and uses no index as identity", () => {
    const source = stripComments(read("lib/content/moment-target.ts"));
    const fn = source.slice(source.indexOf("export function rotateSequenceToTarget"));
    expect(fn).not.toContain(".sort(");
    expect(fn).toContain("findIndex((moment) => moment.id === id)");
  });
});

describe("viewer sequence wiring", () => {
  const page = read("components/content/moments-page.tsx");
  const viewer = read("components/content/moment-media-viewer.tsx");

  it("hands the viewer a rotated view, leaving the page in canonical order", () => {
    expect(page).toContain("sequence={rotateSequenceToTarget(shown, fullScreenFor.id)}");
    // `shown` itself is never rotated, so the list behind stays as it was.
    expect(page).not.toContain("setShown(");
    expect(page).not.toContain("rotateSequenceToTarget(shown, fullScreenFor.id))");
  });

  it("opens on the tapped Moment", () => {
    // Index 0 of a rotated sequence IS the tapped Moment.
    expect(viewer).toContain("const [activeIndex, setActiveIndex] = useState(0);");
  });

  it("continues circularly at both ends", () => {
    expect(viewer).toContain("(current + delta + items.length) % items.length");
  });

  it("replaces the Moment parameter per step instead of pushing history", () => {
    expect(page).toContain("window.history.replaceState");
    expect(page).not.toContain("history.pushState(window.history.state");
  });

  it("returns to the same tab and position on close", () => {
    // replaceState, not a navigation: the page behind is neither remounted nor
    // scrolled.
    expect(page).toContain("window.history.replaceState(window.history.state, \"\", urlWithoutMomentParam(tab))");
  });

  it("does not refetch the feed to build the sequence", () => {
    expect(viewer).not.toContain("getMomentFeedAction");
    expect(viewer).not.toContain("getOpenMomentFeedAction");
  });

  it("keeps horizontal navigation from triggering swipe-down dismissal", () => {
    expect(viewer).toContain("Math.abs(distanceX) > Math.abs(distance)");
  });
});
