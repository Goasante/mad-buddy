import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { stripComments } from "@/lib/content/strip-comments";
import { buildContentSecurityPolicy } from "@/lib/security/csp";

/**
 * Two defects the user found by using the app, both invisible to every test
 * that existed at the time.
 *
 * 1. The cover preview showed a broken image, because the CSP forbade blob:.
 * 2. Opening an Event sometimes produced a blank, blurred screen, because the
 *    load ran inside startTransition and React aborted it.
 *
 * Neither could be caught by asserting on source text alone -- which is exactly
 * why the earlier report wrongly claimed the preview worked. What these tests
 * CAN do is stop each specific cause coming back.
 */

const read = (path: string) => stripComments(readFileSync(path, "utf8"));

const page = read("components/events/events-page.tsx");
const actions = read("app/(app)/event-actions.ts");
const service = read("lib/events/mobile.ts");

// ---------------------------------------------------------------------------
// A. The cover preview
// ---------------------------------------------------------------------------

describe("a chosen photo can actually be previewed", () => {
  it("allows blob: images, which every local preview depends on", () => {
    /* THE BUG. img-src listed 'self' and data: but not blob:, so the browser
     * refused to paint any URL.createObjectURL preview. The container rendered
     * at full size with a broken-image icon inside it, which is precisely what
     * the user saw on the Review step.
     *
     * This was never Events-specific: the avatar cropper, Mad Cam and voice
     * notes preview the same way and were all affected in production. */
    const policy = buildContentSecurityPolicy({
      supabaseOrigin: "https://abc123.supabase.co",
      mode: "enforce"
    });
    const imgSrc = policy.split(";").find((part) => part.trim().startsWith("img-src")) ?? "";
    expect(imgSrc).toContain("blob:");
  });

  it("keeps the preview and the upload on one pipeline", () => {
    // The preview is kept because it works, not because the reference has one.
    // What matters is that it feeds the canonical action rather than its own.
    const cover = read("components/events/event-cover-field.tsx");
    expect(cover).toContain("uploadEventCoverAction");
    expect(cover).toContain("compressImageForUpload");
  });
});

// ---------------------------------------------------------------------------
// B. Opening an Event
// ---------------------------------------------------------------------------

describe("opening an Event always resolves to something", () => {
  it("loads a linked Event outside startTransition", () => {
    /* THE BUG. A transition is interruptible by design, and React abandoned
     * this one -- the Server Action request was aborted mid-flight (visible in
     * the dev log as `Error: aborted`). The fetch never resolved, so the
     * pending flag was never cleared and the screen sat on "Opening event…"
     * with a blurred app behind it. That was the blank Event.
     *
     * Opening the Event the URL names is not optional background work; it is
     * the entire reason the page was opened. */
    const effect = page.slice(
      page.indexOf("const known = initialEvents.find"),
      page.indexOf("const selectedEvent = events.find")
    );
    expect(effect).toContain("void (async () => {");
    expect(effect).toContain("getEventByIdAction(requestedId)");
    /* The load must not be wrapped in an interruptible transition. Checked as
     * "no startTransition immediately before the fetch" rather than "no
     * startTransition anywhere": the same effect legitimately uses one for the
     * Glow roster, which IS optional background work. */
    const beforeFetch = effect.slice(0, effect.indexOf("getEventByIdAction(requestedId)"));
    expect(beforeFetch.slice(-200)).not.toContain("startTransition");
  });

  it("guards stale responses by id rather than by a closure flag", () => {
    /* React invokes effects twice in development. A `cancelled` boolean makes
     * the first pass skip clearing the pending flag it already set, and a
     * "already fetched" ref makes the second pass return early -- so the only
     * live request is the cancelled one. Comparing against the id currently
     * being requested is correct under both passes, and also stops an older
     * response overwriting a newer one when the viewer switches Events. */
    expect(page).toContain("inFlightLinkRef.current = requestedId;");
    expect(page).toContain("const isCurrent = () => inFlightLinkRef.current === requestedId;");
  });

  it("resolves a linked Event through the direct-access authority", () => {
    /* listEvents answers "what may this person BROWSE", and an unlisted
     * "anyone with the link" Event is never in it -- that is what unlisted
     * means. Resolving the deep link against that list meant a shared link
     * opened nothing at all, silently. */
    expect(page).toContain("getEventByIdAction(requestedId)");
    expect(actions).toContain("export async function getEventByIdAction");
    expect(service).toContain("export async function getEventViewForViewer");
  });

  it("does not widen who may open an Event", () => {
    // Every refusal still comes from getEventForViewer: block check first,
    // then canViewEvent. The action returns null and says nothing about why.
    expect(service).toContain('const { getEventForViewer } = await import("@/lib/events/access");');
    expect(service).toContain("if (!access.ok) return null;");
  });

  it("never leaves the app blurred when an Event will not open", () => {
    // Every outcome is explicit: loading, open, or unavailable with a way out.
    expect(page).toContain("linkedEventPending");
    expect(page).toContain("Opening event");
    expect(page).toContain("We couldn&apos;t open this event.");
    expect(page).toContain("Browse events");
  });

  it("does not disclose why an Event is unavailable", () => {
    /* "Deleted", "you are blocked" and "not invited" must read identically:
     * distinguishing them tells somebody an Event exists, or that a block
     * exists, when they may see neither. */
    const failure = page.slice(page.indexOf("We couldn&apos;t open this event."));
    expect(failure.slice(0, 400)).toContain("It may have been removed, or it is not shared with you.");
    expect(failure.slice(0, 400)).not.toContain("blocked");
    expect(failure.slice(0, 400)).not.toContain("not invited");
  });

  it("keeps the open sheet agreeing with the address bar", () => {
    // selectedId used to be initialised from the URL but never updated, so
    // moving between two shared links left the previous Event selected.
    expect(page).toContain("setSelectedId(requestedId);");
  });
});
