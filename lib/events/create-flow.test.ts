import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkCoverAsset, clampFocal } from "@/lib/events/cover";
import { stripComments, stripFormatting } from "@/lib/content/strip-comments";

/** Whitespace-tolerant: a formatter rewrapping JSX must not fail a test. */
const flat = (source: string) => stripFormatting(source);

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

const eventsMobile = read("lib/events/mobile.ts");
const eventsPage = read("components/events/events-page.tsx");
const coverField = read("components/events/event-cover-field.tsx");
const coverActions = read("app/(app)/event-cover-actions.ts");
const ranking = read("lib/events/ranking.ts");
const rankedEvents = read("lib/events/ranked-events.ts");
const rules = read("lib/events/rules.ts");

/**
 * Creating an Event is one continuous action.
 *
 * The cover pipeline attaches assets to an event row, so an id must exist
 * before an image can be uploaded. That is an implementation detail, and it
 * used to leak into the product as "save a draft, reopen the Event, then add
 * a cover". These pin the seam closed in both directions: the person sees one
 * Publish, and the server still refuses to publish anything unverified.
 */

// ---------------------------------------------------------------------------
// The cover requirement is real, not conventional
// ---------------------------------------------------------------------------

describe("publishing requires a verified cover", () => {
  it("creates every event as a draft", () => {
    expect(eventsMobile).toContain('status: "draft"');
  });

  it("offers no way to create a scheduled event directly", () => {
    // `draft: false` used to do exactly this, bypassing the one server action
    // that checks the cover.
    const code = stripComments(eventsMobile);
    const createBlock = code.slice(
      code.indexOf("export async function createEvent"),
      code.indexOf("event_host")
    );
    expect(createBlock).not.toContain('"scheduled"');
  });

  it("still accepts the old draft flag rather than rejecting old clients", () => {
    // Kept in the schema so a stale client succeeds; it simply no longer
    // changes the outcome.
    expect(eventsMobile).toContain("draft: z.boolean().optional()");
  });

  it("verifies the asset server-side before publishing", () => {
    // Ownership, context, processing and moderation are all re-read from the
    // row -- never trusted from what the client sent.
    const publish = coverActions.slice(coverActions.indexOf("export async function publishEventAction"));
    for (const check of ["owner_id", "context_type", "processing_status", "moderation_status"]) {
      expect(publish, check).toContain(check);
    }
  });

  it("refuses to publish an event with no cover pointer", () => {
    const publish = coverActions.slice(coverActions.indexOf("export async function publishEventAction"));
    expect(publish).toContain("cover_media_id");
  });
});

// ---------------------------------------------------------------------------
// One continuous Publish
// ---------------------------------------------------------------------------

describe("the cover is chosen during creation", () => {
  it("takes a file before any event exists", () => {
    // The picker is rendered in the create modal with a null event id.
    expect(eventsPage).toContain("eventId={null}");
    expect(eventsPage).toContain("onPendingFile={setPendingCover}");
  });

  it("no longer tells the creator to save a draft first", () => {
    // The exact copy that made this a two-trip flow.
    expect(coverField).not.toContain("Save the Event first");
    expect(eventsPage).not.toContain("Save this as a draft first");
  });

  it("holds the chosen file until an id exists", () => {
    expect(eventsPage).toContain("const [pendingCover, setPendingCover] = useState<File | null>(null)");
  });

  it("uploads, positions and publishes as one operation", () => {
    /* Anchored on the COVER IMPORT rather than `const result = await
     * createEventAction`. That line became a ternary when resuming a draft
     * started routing to updateEventDraftAction instead, and the old anchor
     * silently sliced an empty string -- a test that passed on nothing. */
    const start = eventsPage.indexOf("const { uploadEventCoverAction");
    const create = eventsPage.slice(start, eventsPage.indexOf("setCreateOpen(false)", start));
    expect(start).toBeGreaterThan(-1);
    expect(create).toContain("uploadEventCoverAction");
    expect(create).toContain("setEventCoverFocalAction");
    expect(create).toContain("publishEventAction");
  });

  it("compresses the held image with the canonical compressor", () => {
    // Not a second uploader or a second compressor.
    expect(coverField).toContain("compressImageForUpload");
    expect((coverField.match(/compressImageForUpload/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// Failure leaves nothing half-made
// ---------------------------------------------------------------------------

describe("a failed publish is recoverable", () => {
  it("does not publish when the cover upload fails", () => {
    /* The rule is unchanged -- a failed cover must never reach publish -- but
     * it is now enforced by a `failure` variable that the publish call is
     * GUARDED on, rather than by an early return. The guard is the thing worth
     * pinning: a bare `return;` inside the upload branch is one refactor away
     * from being replaced, whereas `if (!failure)` states the dependency. */
    const create = eventsPage.slice(eventsPage.indexOf("const uploaded = await uploadEventCoverAction"));
    const failure = create.slice(0, create.indexOf("publishEventAction"));
    expect(failure).toContain("if (!uploaded.ok)");
    expect(failure).toContain("failure = uploaded.message;");
    expect(failure).toContain("if (!failure) {");
  });

  it("says one plain thing, with no internals", () => {
    /* The message now comes from the upload action itself. An upload can fail
     * for storage, moderation, rate limiting or size, and a single hardcoded
     * "Couldn't upload that cover" told the person the wrong thing in three of
     * those four cases. What still matters is that no internals leak, which is
     * asserted below against the surfaced message and the publish-failure copy
     * the person actually reads. */
    /* Comments are stripped before the leak check. eventsPage is read raw, so
     * a comment EXPLAINING that an upload can fail for storage or moderation
     * counted as leaking those words to the user -- flagging the reasoning for
     * the rule as a violation of it. Only shipped strings can leak. */
    const code = stripComments(eventsPage);
    const create = code.slice(code.indexOf("const uploaded = await uploadEventCoverAction"));
    const message = create.slice(0, create.indexOf("publishEventAction"));
    expect(message).toContain("failure = uploaded.message;");
    expect(code).toContain("We couldn&apos;t publish your Event. Your draft is safe.");
    for (const leak of ["media_assets", "processing_status", "Supabase", "MIME", "storage"]) {
      expect(message, leak).not.toContain(leak);
    }
  });

  it("keeps what the creator typed when publishing fails", () => {
    // resetFields() used to run unconditionally on submit, so a failure
    // emptied the form the person would need to retry from.
    const submit = eventsPage.slice(
      eventsPage.indexOf("function submit(asDraft: boolean)"),
      eventsPage.indexOf("function resetFields()")
    );
    expect(submit).not.toContain("resetFields()");
  });

  it("leaves the event as a private draft on failure", () => {
    // Drafts are host-only, so a failed publish cannot reach discovery.
    expect(eventsMobile).toContain('if (event.status === "draft" && event.host_id !== userId) return false;');
  });
});

// ---------------------------------------------------------------------------
// A provisional draft is never public
// ---------------------------------------------------------------------------

describe("drafts stay out of discovery", () => {
  it("is excluded from ranked discovery", () => {
    expect(rankedEvents).toContain('.in("status", ["scheduled", "active"])');
  });

  it("is excluded from ranking", () => {
    expect(ranking).toContain('event.status === "draft"');
  });

  it("is excluded by the shared eligibility rules", () => {
    expect(rules).toContain('input.eventStatus === "draft"');
  });

  it("is visible only to its host", () => {
    expect(eventsMobile).toContain('event.status === "draft" && event.host_id !== userId');
  });
});

// ---------------------------------------------------------------------------
// Focal positioning, not destructive cropping
// ---------------------------------------------------------------------------

describe("cover positioning", () => {
  it("keeps focal values inside the frame", () => {
    expect(clampFocal(-1)).toBe(0);
    expect(clampFocal(2)).toBe(1);
    expect(clampFocal(0.42)).toBeCloseTo(0.42);
  });

  it("stores a focal point rather than a second cropped image", () => {
    expect(coverActions).toContain("cover_focal_x");
    expect(coverActions).toContain("cover_focal_y");
  });

  it("carries the chosen position into the publish flow", () => {
    // Same re-anchoring as above: the createEventAction call is now a ternary.
    const create = eventsPage.slice(eventsPage.indexOf("const { uploadEventCoverAction"));
    expect(create.slice(0, 2000)).toContain("setEventCoverFocalAction");
    expect(create.slice(0, 2000)).toContain("focalX: input.focalX");
  });
});

// ---------------------------------------------------------------------------
// Replacement safety
// ---------------------------------------------------------------------------

describe("replacing a cover", () => {
  it("only swaps the preview after the server confirms", () => {
    // A failed replacement must leave the existing cover intact.
    const upload = coverField.slice(coverField.indexOf("const result = await uploadEventCoverAction"));
    const failure = upload.slice(0, upload.indexOf("onChange("));
    expect(failure).toContain("if (!result.ok)");
    expect(failure).toContain("return;");
  });

  it("moves the pointer only after the new asset is ready", () => {
    expect(coverActions).toContain('processing_status: "ready"');
  });
});

// ---------------------------------------------------------------------------
// The publish rule itself, exercised rather than read
// ---------------------------------------------------------------------------

describe("what may become an Event cover", () => {
  const HOST = "11111111-1111-4111-8111-111111111111";
  const ready = {
    ownerId: HOST,
    contextType: "event",
    processingStatus: "ready",
    moderationStatus: "active",
    deletedAt: null as string | null
  };

  it("accepts an owned, ready, active event asset", () => {
    expect(checkCoverAsset(ready, HOST)).toEqual({ ok: true });
  });

  it("refuses an asset that is still processing", () => {
    // Publishing here would put a half-processed image on a ranked surface.
    expect(checkCoverAsset({ ...ready, processingStatus: "pending" }, HOST)).toEqual({
      ok: false,
      reason: "not_ready"
    });
  });

  it("refuses an asset under moderation", () => {
    for (const status of ["under_review", "restricted", "removed"]) {
      expect(checkCoverAsset({ ...ready, moderationStatus: status }, HOST), status).toEqual({
        ok: false,
        reason: "moderated"
      });
    }
  });

  it("refuses another person's asset", () => {
    expect(checkCoverAsset(ready, "22222222-2222-4222-8222-222222222222")).toEqual({
      ok: false,
      reason: "not_owned"
    });
  });

  it("refuses an asset from another context", () => {
    // A chat or moment upload must not be repointed at an event.
    expect(checkCoverAsset({ ...ready, contextType: "chat" }, HOST)).toEqual({
      ok: false,
      reason: "wrong_context"
    });
  });

  it("refuses a deleted asset and a missing one", () => {
    expect(checkCoverAsset({ ...ready, deletedAt: "2026-01-01T00:00:00Z" }, HOST).ok).toBe(false);
    expect(checkCoverAsset(null, HOST)).toEqual({ ok: false, reason: "missing" });
  });

  it("is what the publish action actually consults", () => {
    // The rule above is only meaningful if publishing runs it.
    expect(coverActions).toContain("checkCoverAsset");
  });
});

describe("schedule validation", () => {
  it("rejects an event that ends before it starts", () => {
    expect(eventsMobile).toContain('if (endsMs <= startsMs) return { ok: false, message: "The event must end after it starts." };');
  });

  it("rejects an event that ends exactly when it starts", () => {
    // `<=`, not `<`: a zero-length event is not a schedule.
    expect(eventsMobile).toContain("endsMs <= startsMs");
  });
});

// ---------------------------------------------------------------------------
// The form feel is gone
// ---------------------------------------------------------------------------

describe("Create Event reads as a sheet, not a form", () => {
  const createModal = eventsPage.slice(
    eventsPage.indexOf("function CreateEventModal"),
    eventsPage.indexOf("function EventDetailsModal")
  );

  it("wraps no field in a bordered FormField box", () => {
    // Six FormField wrappers -- name, date, starts, ends, venue, description
    // -- were what made this read as an admin form.
    expect(createModal).not.toContain("<FormField");
    expect(eventsPage).not.toContain('from "@/components/auth/form-field"');
  });

  it("uses no bordered Input control in the create sheet", () => {
    expect(createModal).not.toContain("<Input");
  });

  it("separates sections with hairlines rather than cards", () => {
    expect(createModal).not.toContain("<Card");
    expect(createModal).toContain("border-t border-border/60");
  });

  it("puts the cover first and large", () => {
    const coverAt = createModal.indexOf("<EventCoverField");
    const nameAt = createModal.indexOf('id="event-name"');
    expect(coverAt).toBeGreaterThan(-1);
    expect(coverAt).toBeLessThan(nameAt);
  });

  it("keeps every control reachable by assistive technology", () => {
    /* SUPERSEDED FORM, SAME GUARANTEE (4J §38-40). The name and description
     * inputs were borderless and carried aria-label; they now have VISIBLE
     * labels, which is strictly better -- a sighted person could not tell the
     * old ones were editable at all.
     *
     * What must stay true either way: every control has an accessible name,
     * whether from a <label htmlFor> or an aria-label. */
    for (const id of ["event-name", "event-description", "event-date", "event-start", "event-end"]) {
      expect(createModal, id).toContain(`htmlFor="${id}"`);
    }
    // The venue field keeps an aria-label: its section heading is "Where",
    // which names the group rather than the input.
    expect(createModal).toContain('aria-label="Location"');
  });
});

describe("When is one section", () => {
  const createModal = eventsPage.slice(
    eventsPage.indexOf("function CreateEventModal"),
    eventsPage.indexOf("function EventDetailsModal")
  );

  it("groups date, start and end under a single heading", () => {
    expect(flat(createModal)).toContain("> When <");
  });

  it("still drives the canonical schedule values", () => {
    // The native pickers remain: no new date engine.
    expect(createModal).toContain('type="date"');
    expect((createModal.match(/type="time"/g) ?? []).length).toBe(2);
    expect(createModal).toContain("setDate(event.target.value)");
    expect(createModal).toContain("setStartTime(event.target.value)");
    expect(createModal).toContain("setEndTime(event.target.value)");
  });

  it("shows an arrow between start and end rather than two labelled boxes", () => {
    expect(createModal).toContain("→");
  });
});

describe("Where is one row", () => {
  const createModal = eventsPage.slice(
    eventsPage.indexOf("function CreateEventModal"),
    eventsPage.indexOf("function EventDetailsModal")
  );

  it("asks for the location in words", () => {
    /* "Add location" was an instruction to the user about the form. "Where is
     * it happening?" is the question the Event actually poses, and it reads as
     * a prompt rather than as a field name. */
    expect(flat(createModal)).toContain("> Where <");
    expect(createModal).toContain('placeholder="Where is it happening?"');
  });
});

describe("one primary action", () => {
  const createModal = eventsPage.slice(
    eventsPage.indexOf("function CreateEventModal"),
    eventsPage.indexOf("function EventDetailsModal")
  );

  it("makes Publish the full-width primary button", () => {
    expect(createModal).toContain('className="h-12 w-full text-base"');
    expect(createModal).toContain("Publish event");
  });

  it("demotes Save draft below it rather than beside it", () => {
    // Three similar buttons in a row made saving a draft look required.
    // Compare within the action row, not the whole component: "Save draft"
    // also appears in the submit handler above it.
    const actionRow = createModal.slice(createModal.indexOf('className="h-12 w-full text-base"'));
    expect(actionRow.indexOf("Save draft")).toBeGreaterThan(actionRow.indexOf("Publish event"));
    // Save draft is a quiet text button, not a second <Button> peer.
    const actions = createModal.slice(createModal.indexOf("Publish event") - 400);
    expect(actions).toContain("text-muted-foreground hover:text-foreground");
  });

  it("shows one loading state for the whole operation", () => {
    // Create, upload, focal and publish are several server steps but one
    // action to the person doing it.
    expect(createModal).toContain("Publishing…");
  });

  it("refuses a second submit while one is in flight", () => {
    const submit = eventsPage.slice(
      eventsPage.indexOf("function submit(asDraft: boolean)"),
      eventsPage.indexOf("function resetFields()")
    );
    /* GUARDED ON ITS OWN SUBMISSION, not on the page-wide `pending`.
     *
     * `pending` is set by unrelated work -- including the cover upload two
     * stages earlier in this same flow -- so guarding on it meant that by the
     * time somebody reached Review and tapped Publish, the flag could still be
     * true and this returned immediately. A dedicated flag gives the same
     * duplicate-tap protection without borrowing an unrelated signal, and the
     * parent releases it through onSettled when the work actually ends. */
    expect(submit).toContain("if (submitting) return;");
    expect(submit).toContain("setSubmitting(true);");
    expect(eventsPage).toContain("input.onSettled?.();");
  });

  it("blocks publishing when the schedule is impossible", () => {
    expect(createModal).toContain("scheduleInvalid");
    expect(eventsPage).toContain("endTime <= startTime");
  });
});

describe("no product semantics were added", () => {
  const createModal = eventsPage.slice(
    eventsPage.indexOf("function CreateEventModal"),
    eventsPage.indexOf("function EventDetailsModal")
  );

  it("asks who should know about the Event", () => {
    /* REVERSED DELIBERATELY (4F). This used to assert that creation offered NO
     * audience control, on the reasoning that "Events stay discoverable; Plans
     * stay the private thing". That reasoning did not survive the product: a
     * wedding is an Event and it is nobody else's business, so the creator now
     * chooses. Creation previously hardcoded `community`, which meant the
     * decision was made for them and never shown. */
    expect(createModal).toContain("<AudienceSelector");
  });

  it("confirms the Event before publishing it", () => {
    /* REVERSED DELIBERATELY (4J §22). This previously asserted there was NO
     * review step, on the reasoning that one scrolling sheet already showed
     * every field -- which was true of that design and is the reason it read
     * as an administrative form.
     *
     * Now that creation is staged, nothing but the current stage is on screen,
     * so publishing without a summary would mean confirming an Event whose
     * audience and schedule the person last saw two steps ago. Review reads
     * those back, and it is the only stage that offers Publish. */
    expect(createModal).toContain('"review"');
    expect(createModal).toContain("Review your Event");
    expect(createModal).toContain('{stage === "review" ? (');
  });
});

// ---------------------------------------------------------------------------
// Publishing always finishes
// ---------------------------------------------------------------------------

describe("the publish flow never strands the sheet", () => {
  /**
   * THE ORIGINAL BUG: the cover-upload failure path returned early, before the
   * block that closes the sheet. The button stayed on "Publishing..." with no
   * way forward -- the Event had been created as a draft, but nothing on screen
   * said so.
   *
   * THESE TWO TESTS WERE ALSO VACUOUS. They sliced up to
   * `const published = await publishEventAction`, a line that no longer exists,
   * so indexOf returned -1, slice(x, -1) returned nearly the whole file, and
   * the assertions passed against text from somewhere else entirely. Both are
   * now anchored on the failure branch itself.
   *
   * AND THE ANSWER CHANGED. Closing the sheet on failure is what made a failed
   * publish look like a successful one. The sheet now STAYS open with the
   * reason stated, so nothing typed is lost and the person can retry.
   */
  const failureBranch = () => {
    const flat = stripFormatting(eventsPage);
    const start = flat.indexOf("if (failure) {");
    expect(start).toBeGreaterThan(-1);
    return flat.slice(start, flat.indexOf("if (!result.ok) {", start));
  };

  it("keeps the sheet open when the cover upload fails", () => {
    const failure = failureBranch();
    expect(failure).not.toContain("setCreateOpen(false)");
    expect(failure).toContain("setPublishFailure(failure);");
    expect(failure).toContain("return;");
  });

  it("says what failed rather than moving the creator somewhere else", () => {
    /* Silently redirecting to Hosting was itself part of the confusion: it
     * looked like a completed step. The draft is safe either way, and the
     * screen now says so where the person already is. */
    const code = stripComments(eventsPage);
    expect(code).toContain("We couldn&apos;t publish your Event. Your draft is safe.");
    expect(code).toContain("Try again");
    expect(code).toContain("Back to draft");
  });

  it("starts every Create from empty state", () => {
    // The parent closes the sheet directly after a successful publish, which
    // bypasses the child's own reset -- so the modal is remounted instead.
    expect(eventsPage).toContain("const [createSession, setCreateSession] = useState(0)");
    expect(eventsPage).toContain("key={createSession}");
    expect(eventsPage).toContain("<CreateEventModal");
  });

  it("clears the held cover along with the text fields", () => {
    const reset = eventsPage.slice(
      eventsPage.indexOf("function resetFields()"),
      eventsPage.indexOf("function handleOpenChange")
    );
    expect(reset).toContain("setPendingCover(null)");
    expect(reset).toContain("setCover({ url: null, focalX: 0.5, focalY: 0.5 })");
  });
});
