import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { stripComments, stripFormatting } from "@/lib/content/strip-comments";

/**
 * The Event lifecycle: draft -> publishing -> published.
 *
 * Every rule here comes from a failure the user hit in the running app, where
 * the UI reported one thing and the database held another. The recurring shape
 * is a screen inferring success from the fact that it navigated, so these pin
 * the places where the server's answer must be the one that counts.
 */

const read = (path: string) => stripComments(readFileSync(path, "utf8"));
const flat = (path: string) => stripFormatting(readFileSync(path, "utf8"));

const page = read("components/events/events-page.tsx");
const pageFlat = flat("components/events/events-page.tsx");
const hosting = read("components/events/events-hosting.tsx");
const service = read("lib/events/mobile.ts");
const actions = read("app/(app)/event-actions.ts");

// ---------------------------------------------------------------------------
// A. Publish must transition the canonical row
// ---------------------------------------------------------------------------

describe("publishing transitions the Event, and says so honestly", () => {
  it("reads published state from the server, never from navigation", () => {
    /* THE BUG. A failed publish set a message and then fell through into the
     * success block anyway, announcing "Event published" over an Event still
     * in draft -- which is exactly what the user saw under Hosting -> Drafts.
     * `published` now holds the action's own answer. */
    expect(pageFlat).toContain("const publishResult = await publishEventAction(eventId);");
    expect(pageFlat).toContain("published = publishResult.ok;");
    expect(pageFlat).toContain("if (!publishResult.ok) failure = publishResult.message;");
  });

  it("never announces success while a failure is pending", () => {
    // The failure branch returns; it does not fall through.
    const handler = pageFlat.slice(pageFlat.indexOf("if (failure) {"));
    expect(handler.slice(0, 400)).toContain("setPublishFailure(failure);");
    expect(handler.slice(0, 400)).toContain("return;");
  });

  it("offers the share moment only for a confirmed publish", () => {
    /* A draft has no shareable identity, and handing out its URL would give
     * somebody a link that refuses everybody. */
    expect(pageFlat).toContain("if (eventId && published) { setPublishedEvent(");
  });

  it("puts the server's status on the optimistic row", () => {
    // The list used to guess from what was SENT ("did we attach a cover?"),
    // which is how a draft could appear in Upcoming and vice versa.
    expect(pageFlat).toContain('status: published ? "scheduled" : "draft",');
  });
});

// ---------------------------------------------------------------------------
// B. Failure must look like failure
// ---------------------------------------------------------------------------

describe("a failed publish keeps the draft and says why", () => {
  it("states the failure without blaming the cover for everything", () => {
    /* An upload can fail for storage, moderation, rate limiting or size --
     * uploaded.message says which, so it is surfaced rather than replaced with
     * a guess about the cover. */
    expect(pageFlat).toContain("failure = uploaded.message;");
    expect(page).toContain("We couldn&apos;t publish your Event. Your draft is safe.");
  });

  it("offers a way forward rather than a dead end", () => {
    expect(page).toContain("Try again");
    expect(page).toContain("Back to draft");
  });

  it("keeps the sheet open so nothing typed is lost", () => {
    /* Closing the sheet is what made a failure look like a success. Bounded to
     * the branch itself: a fixed character window runs on into the SUCCESS
     * path, where closing the sheet is correct -- and a test that reads past
     * its own subject proves nothing. */
    const start = pageFlat.indexOf("if (failure) {");
    const failureBlock = pageFlat.slice(start, pageFlat.indexOf("if (!result.ok) {", start));
    expect(failureBlock).not.toContain("setCreateOpen(false)");
    expect(failureBlock).toContain("return;");
  });
});

// ---------------------------------------------------------------------------
// C. Resuming a draft
// ---------------------------------------------------------------------------

describe("Continue resumes the draft it names", () => {
  it("opens the creation flow, not the Event detail", () => {
    /* THE BUG. Continue called onOpen, which opens the DETAIL sheet -- and a
     * draft with no cover renders almost nothing there, so the person got a
     * dimmed screen with an empty panel and no way to finish. */
    expect(hosting).toContain("onResumeDraft(event.id)");
    const draftsSection = hosting.slice(hosting.indexOf("Drafts"), hosting.indexOf("Upcoming"));
    expect(draftsSection).not.toContain("onOpen(event.id)");
  });

  it("loads the draft through its own authority, not the discovery list", () => {
    expect(actions).toContain("export async function getEventDraftAction");
    expect(service).toContain("export async function getEventDraftForHost");
    // Host-only, drafts-only: a published Event is edited on its own surfaces.
    const loader = service.slice(service.indexOf("export async function getEventDraftForHost"));
    expect(loader.slice(0, 900)).toContain("if (event.host_id !== userId) return null;");
    expect(loader.slice(0, 900)).toContain('if (event.status !== "draft") return null;');
  });

  it("seeds the form from the draft rather than filling it in afterwards", () => {
    // An effect writing fields post-mount is what makes a resumed draft flash
    // empty before populating.
    expect(pageFlat).toContain("useState(draft?.name ?? \"\")");
    expect(pageFlat).toContain("useState(draft?.venueLabel ?? \"\")");
  });

  it("resumes at the first genuinely incomplete stage", () => {
    /* Sending somebody back to re-answer four completed stages is its own
     * failure. When nothing is missing it opens Review, where the only thing
     * left to do is publish. */
    expect(pageFlat).toContain('if (!draft) return "audience";');
    expect(pageFlat).toContain('if (draft.name.trim().length < 2 || !draft.coverUrl) return "basics";');
    expect(pageFlat).toContain('return "review";');
  });

  it("never leaves a bare overlay", () => {
    // Loading and failure are both stated, and the failure offers a way back.
    expect(page).toContain("Opening your draft…");
    expect(page).toContain("We couldn&apos;t open that draft.");
    expect(page).toContain("Back to Hosting");
  });

  it("keeps failure distinguishable from still-loading", () => {
    /* Asserting only that both strings EXIST let a mutation that routed a
     * failed load back into "loading" pass -- and a permanent spinner over a
     * draft that will never arrive is the same dead end as the blank overlay,
     * just slower to recognise. So pin the branch itself: the not-found path
     * sets "failed", and the overlay renders that as an alert, not a status. */
    const loader = pageFlat.slice(pageFlat.indexOf("function continueDraft("));
    expect(loader.slice(0, 500)).toContain('if (!draft) { setResumeState("failed"); return; }');
    expect(pageFlat).toContain('{resumeState === "failed" ? ( <div role="alert"');
  });

  it("opens the sheet only once the draft is in hand", () => {
    /* ORDER IS THE WHOLE BUG. Opening the sheet first and filling it in later
     * is precisely what produced a dimmed screen with no creation UI. The
     * draft must be seated BEFORE createOpen flips, and remounting via the
     * session key is what makes the seeded useState initialisers re-run. */
    const loader = pageFlat.slice(pageFlat.indexOf("function continueDraft("));
    const body = loader.slice(0, 500);
    const seated = body.indexOf("setResumeDraft(draft);");
    const opened = body.indexOf("setCreateOpen(true);");
    expect(seated).toBeGreaterThan(-1);
    expect(opened).toBeGreaterThan(-1);
    expect(seated).toBeLessThan(opened);
    expect(body).toContain("setCreateSession((n) => n + 1);");
  });

  it("publishes the SAME Event rather than creating a second one", () => {
    /* Resuming used to call create again, inserting a duplicate row and
     * stranding the original in Drafts -- two Events with one name, one of
     * them unreachable. */
    expect(pageFlat).toContain("draftId: draft?.id ?? null");
    expect(pageFlat).toContain("const result = input.draftId ? await updateEventDraftAction(input.draftId, payload)");
    expect(pageFlat).toContain("const eventId = input.draftId ?? result.eventId;");
  });

  it("refuses to rewrite an Event that is already published", () => {
    // Attendees have answered based on what it said; editing a live Event is a
    // different feature with different rules.
    const update = service.slice(service.indexOf("export async function updateEventDraft"));
    expect(update.slice(0, 1600)).toContain('if (existing.status !== "draft")');
    expect(update.slice(0, 1600)).toContain("if (existing.host_id !== userId)");
  });

  it("holds a resumed draft to the same audience rules as a new Event", () => {
    // A draft must not be saveable into a state a new Event would be refused
    // for -- an invited Event with nobody invited, say.
    const update = service.slice(service.indexOf("export async function updateEventDraft"));
    expect(update.slice(0, 2200)).toContain("validateAudienceRequirements({");
    expect(update.slice(0, 2200)).toContain("createEventSchema.safeParse(input)");
  });

  it("counts a stored location as satisfying the Nearby requirement", () => {
    /* A resumed Nearby draft already has coordinates on the server. Demanding
     * them again would make it impossible to publish without re-granting
     * geolocation every session. */
    const update = service.slice(service.indexOf("export async function updateEventDraft"));
    expect(update.slice(0, 2200)).toContain("Boolean(parsed.data.location) || Boolean(storedLocation)");
  });
});

// ---------------------------------------------------------------------------
// D. Saving a draft
// ---------------------------------------------------------------------------

describe("a draft can be saved while it is still unfinished", () => {
  it("does not require everything publishing requires", () => {
    /* THE CONTRADICTION. Save draft was disabled until the Event was
     * `complete` -- the same bar publishing clears -- so the only Events you
     * could save as drafts were ones you could already publish. A draft exists
     * precisely for the unfinished state. */
    const saveButton = pageFlat.slice(pageFlat.indexOf("Save draft") - 700, pageFlat.indexOf("Save draft"));
    expect(saveButton).not.toContain("disabled={!complete || pending}");
    expect(saveButton).toContain("name.trim().length < 2");
  });
});
