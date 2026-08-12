import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { stripComments } from "@/lib/content/strip-comments";

/**
 * Stage F UI: creator media, arrival, post-check-in, Event Mode.
 *
 * Source-text assertions: these are client components and vitest runs
 * environment "node", so there is no DOM to mount them into. What is asserted
 * is structural and could not pass by accident -- each of these was verified
 * to fail when the behaviour it describes is removed.
 */

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const coverField = stripComments(read("components/events/event-cover-field.tsx"));
const eventsPage = stripComments(read("components/events/events-page.tsx"));
const successSheet = stripComments(read("components/events/check-in-success-sheet.tsx"));
const arrivalPrompt = stripComments(read("components/events/arrival-prompt.tsx"));
const banner = stripComments(read("components/socialize/event-mode-banner.tsx"));
const discoverPage = stripComments(read("app/(app)/discover/page.tsx"));
const eventsMobile = stripComments(read("lib/events/mobile.ts"));

// ---------------------------------------------------------------------------
// PART A — creator media UX
// ---------------------------------------------------------------------------

describe("the cover field reuses canonical infrastructure", () => {
  it("uses the shared upload action, not a new one", () => {
    expect(coverField).toContain("uploadEventCoverAction");
    expect(coverField).toContain("setEventCoverFocalAction");
  });

  it("compresses client-side like every other upload", () => {
    expect(coverField).toContain("compressImageForUpload");
  });

  it("does not build a second camera or editor", () => {
    expect(coverField).not.toContain("getUserMedia");
    expect(coverField).not.toContain("ImageEditor");
    expect(coverField).not.toContain("camera");
  });

  it("uses the canonical hidden-input picker pattern", () => {
    expect(coverField).toContain('type="file"');
    expect(coverField).toContain('accept="image/*"');
    // Cleared so re-choosing the same file still fires.
    expect(coverField).toContain("changeEvent.target.value = \"\"");
  });
});

describe("cover upload states", () => {
  it("shows progress while uploading", () => {
    expect(coverField).toContain("Loader2");
    expect(coverField).toContain("Uploading cover image");
  });

  it("blocks duplicate submissions while one is in flight", () => {
    expect(coverField).toContain("if (busy) return;");
  });

  it("keeps the existing cover on screen until the server confirms", () => {
    // onChange only runs AFTER the ok check -- a failed replacement leaves
    // the old artwork exactly where it was.
    const failureBranch = coverField.slice(coverField.indexOf("if (!result.ok)"));
    expect(failureBranch.slice(0, 200)).toContain("return;");
    const okIndex = coverField.indexOf("if (!result.ok)");
    expect(coverField.indexOf("onChange({ url: previewUrl")).toBeGreaterThan(okIndex);
  });

  it("surfaces a retryable error rather than swallowing it", () => {
    expect(coverField).toContain('role="alert"');
    expect(coverField).toContain("setError(result.message)");
  });

  it("says Change cover once one exists", () => {
    expect(coverField).toContain('hasCover ? "Change cover" : "Add event cover"');
  });
});

describe("focal positioning is touch-first", () => {
  it("uses pointer events, not mouse-only handlers", () => {
    for (const handler of ["onPointerDown", "onPointerMove", "onPointerUp"]) {
      expect(coverField, handler).toContain(handler);
    }
    expect(coverField).not.toContain("onMouseDown");
  });

  it("stops the page fighting the drag gesture", () => {
    expect(coverField).toContain('touchAction: hasCover ? "none" : undefined');
  });

  it("writes the existing focal columns rather than a new crop", () => {
    expect(coverField).toContain("focalX");
    expect(coverField).toContain("focalY");
    expect(coverField).not.toContain("crop");
  });

  it("clamps whatever the drag produces", () => {
    expect(coverField).toContain("clampFocal");
  });

  it("previews the most demanding crop", () => {
    expect(coverField).toContain('PREVIEW_ASPECT = "4 / 5"');
    expect(coverField).toContain("This is how your Event may appear in discovery.");
  });
});

describe("draft versus publish", () => {
  it("creates events as drafts so a cover can be attached", () => {
    expect(eventsMobile).toContain('parsed.data.draft === false ? "scheduled" : "draft"');
  });

  it("offers Save draft and Publish as distinct actions", () => {
    expect(eventsPage).toContain("Save draft");
    expect(eventsPage).toContain("Publish event");
  });

  it("lets a draft be saved with no cover", () => {
    // submit(true) short-circuits the cover requirement entirely.
    expect(eventsPage).toContain("if (!asDraft && !cover.url)");
  });

  it("catches publish-without-cover in the UI with the real message", () => {
    expect(eventsPage).toContain('"Add an Event cover before publishing."');
    expect(eventsPage).toContain("scrollIntoView");
  });

  it("keeps the server rule authoritative", () => {
    expect(eventsPage).toContain("publishEventAction");
    expect(eventsPage).toContain("setPublishError(result.message)");
  });

  it("shows a host their own draft so they can finish it", () => {
    expect(eventsMobile).toContain('.in("status", ["draft", "scheduled", "active"])');
  });

  it("never lists someone else's draft", () => {
    expect(eventsMobile).toContain('if (event.status === "draft" && event.host_id !== userId) return false;');
  });
});

// ---------------------------------------------------------------------------
// PART B — arrival
// ---------------------------------------------------------------------------

describe("the arrival prompt", () => {
  it("offers exactly Check in and Not yet", () => {
    expect(arrivalPrompt).toContain("Are you here?");
    expect(arrivalPrompt).toContain("Check in");
    expect(arrivalPrompt).toContain("Not yet");
  });

  it("protects against duplicate taps", () => {
    expect(arrivalPrompt).toContain("const busy = pending || submitted");
    expect(arrivalPrompt).toContain("disabled={busy}");
  });

  it("renders decision only -- it does not decide eligibility", () => {
    // resolveArrivalPrompt already decided, server-side.
    for (const term of ["myRsvp", "checkInWindowOpen", "resolveArrivalPrompt"]) {
      expect(arrivalPrompt, term).not.toContain(term);
    }
  });

  it("adds no notification of its own", () => {
    for (const term of ["deliverNotification", "push", "enqueueJob"]) {
      expect(arrivalPrompt, term).not.toContain(term);
    }
  });
});

// ---------------------------------------------------------------------------
// PART C — post-check-in
// ---------------------------------------------------------------------------

describe("the success sheet", () => {
  it("opens only after the server confirms the check-in", () => {
    const checkInFn = eventsPage.slice(
      eventsPage.indexOf("function checkIn("),
      eventsPage.indexOf("function publish(")
    );
    const okIndex = checkInFn.indexOf("if (result.ok && result.checkInId)");
    expect(okIndex).toBeGreaterThan(-1);

    // Position alone is not enough: a call placed AFTER the success block but
    // OUTSIDE it would also be "later in the file" while still firing on
    // failure. This checks the call is INSIDE the ok branch, by confirming it
    // appears before that block's closing brace.
    const afterOk = checkInFn.slice(okIndex);
    const blockEnd = afterOk.indexOf("\n      }");
    const okBlock = afterOk.slice(0, blockEnd);
    expect(blockEnd).toBeGreaterThan(-1);
    expect(okBlock).toContain("setCheckedInEvent(");
  });

  it("uses the canonical sheet rather than a new one", () => {
    expect(successSheet).toContain('variant="sheet"');
    expect(successSheet).toContain('from "@/components/ui/modal"');
  });

  it("offers three optional actions and forces none", () => {
    expect(successSheet).toContain("See Muddies here");
    expect(successSheet).toContain("Meet people nearby");
    expect(successSheet).toContain("Done");
  });

  it("does not overclaim privacy", () => {
    // The copy follows the viewer's REAL glow state rather than reassuring
    // them unconditionally.
    expect(successSheet).toContain("glowEnabled");
    expect(successSheet).toContain("Checking in doesn't automatically share your presence.");
  });

  it("routes Muddies-here into the existing Stage E list", () => {
    expect(successSheet).toContain("onSeeMuddies");
    expect(eventsPage).toContain("openDetails(eventId)");
  });

  it("uses the built Event Mode entry point for Meet people nearby", () => {
    expect(successSheet).toContain("eventModeHref");
  });

  it("performs no automatic social action", () => {
    for (const term of ["sendFriendRequest", "wave", "Wave(", "sendMessage", "setEventGlowAction"]) {
      expect(successSheet, term).not.toContain(term);
    }
  });
});

// ---------------------------------------------------------------------------
// Event Mode UI
// ---------------------------------------------------------------------------

describe("Linkr Event Mode context", () => {
  it("is validated server-side against a live check-in", () => {
    expect(discoverPage).toContain("canEnterEventMode");
    expect(discoverPage).toContain('liveCheckIn(admin, userId, "event", eventId)');
    expect(discoverPage).toContain("readEventModeContext");
  });

  it("shows why Linkr opened differently", () => {
    expect(banner).toContain("At ${eventName}");
    expect(banner).toContain("Finding people close by");
  });

  it("leaves Event Mode by navigating, since nothing is stored", () => {
    expect(banner).toContain('router.replace("/discover"');
    for (const term of ["localStorage", "supabase", "update("]) {
      expect(banner, term).not.toContain(term);
    }
  });

  it("does not leak into an ordinary Linkr visit", () => {
    // Plain /discover carries no params, so readEventModeContext returns null,
    // so resolveEventModeName is handed a null eventId and returns null
    // before touching the database. The banner cannot appear.
    expect(discoverPage).toContain("requestedEventMode?.eventId ?? null");
    expect(discoverPage).toContain("if (!eventId || !userId) return null;");
  });

  it("does not widen Linkr eligibility", () => {
    // The page passes a NAME for display. No discovery parameter is altered.
    expect(discoverPage).not.toContain("discoveryScope");
    expect(discoverPage).not.toContain("proximityLevel");
  });
});
