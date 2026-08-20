import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { stripComments } from "@/lib/content/strip-comments";

/**
 * The Events 2.0 product layer: access, admins, Updates, reactions, fanout.
 *
 * These assert the SECURITY boundaries above all -- who may open an Event, who
 * may speak for it, and who gets told. The pure audience rules are covered by
 * behaviour tests in audience-model.test.ts; this file guards the services that
 * consume them, where a missing check is a disclosure rather than a bug.
 */

const access = stripComments(readFileSync("lib/events/access.ts", "utf8"));
const updates = stripComments(readFileSync("lib/events/updates.ts", "utf8"));
const handlers = stripComments(readFileSync("lib/jobs/handlers.ts", "utf8"));
const jobRules = stripComments(readFileSync("lib/jobs/rules.ts", "utf8"));
const actions = stripComments(readFileSync("app/(app)/event-actions.ts", "utf8"));

describe("direct Event access is its own question", () => {
  it("fetches the Event by id rather than searching the discovery feed", () => {
    /* The old shape loaded the whole feed and searched it, which made an
     * unlisted Event unreachable by its own link -- the feed had already
     * excluded it. */
    expect(access).toContain('.from("events")');
    expect(access).toContain('.eq("id", eventId)');
    expect(access).not.toContain("listEvents(");
  });

  it("asks the canonical rule rather than re-deriving audience", () => {
    expect(access).toContain("canViewEvent(");
  });

  it("checks blocks before disclosing anything about the Event", () => {
    const body = access.slice(access.indexOf("export async function getEventForViewer"));
    expect(body.indexOf("isBlockedEitherDirection")).toBeLessThan(body.indexOf("canViewEvent("));
  });

  it("hides a blocked Event behind the same shape as a missing one", () => {
    // Saying "blocked" would disclose both the Event and the block.
    expect(access).toContain('reason: "blocked"');
  });

  it("only pays for audience lookups the audience actually needs", () => {
    // public/nearby/link ask nothing, so they cost nothing.
    expect(access).toContain('if (event.visibility !== "invite" && event.visibility !== "community") return base;');
  });

  it("counts only joined Circle members", () => {
    expect(access).toContain('.eq("status", "joined")');
  });
});

describe("only the Event voice may publish", () => {
  it("refuses an ordinary attendee", () => {
    expect(updates).toContain("if (!access.canManage)");
  });

  it("refuses posting to a cancelled Event", () => {
    expect(updates).toContain('access.event.status === "cancelled"');
  });

  it("rate-limits publishing", () => {
    expect(updates).toContain('action: "events.update"');
  });

  it("keeps appointing admins to the host alone", () => {
    /* An admin who could appoint admins is an owner by another name: they
     * could add an ally and hold the Event between them. */
    const add = updates.slice(updates.indexOf("export async function addEventAdmin"));
    expect(add.slice(0, 700)).toContain("isEventOwner(");
    const remove = updates.slice(updates.indexOf("export async function removeEventAdmin"));
    expect(remove.slice(0, 700)).toContain("isEventOwner(");
  });

  it("never writes the host into the admin table", () => {
    // events.host_id stays sole ownership; a row would be a second source of
    // truth for who owns the Event.
    expect(updates).toContain("targetUserId === access.event.host_id");
  });
});

describe("reading and reacting need the same permission", () => {
  it("gates the Updates list on Event access", () => {
    const list = updates.slice(updates.indexOf("export async function listEventUpdates"));
    expect(list.slice(0, 400)).toContain("getEventForViewer(");
  });

  it("gates reactions on Event access too", () => {
    /* Otherwise a private Event Update is reachable through the reaction path.
     * Scoped to the region BEFORE the write: an earlier version searched the
     * whole function tail, which stayed satisfied by an unrelated mention even
     * with the guard deleted. */
    const react = updates.slice(updates.indexOf("export async function setUpdateReaction"));
    const beforeWrite = react.slice(0, react.indexOf("if (reaction === null)"));
    expect(beforeWrite).toContain("getEventForViewer(");
    expect(beforeWrite).toContain("if (!access.ok)");
  });

  it("never returns who reacted, only how many", () => {
    expect(updates).toContain("reactionCounts");
    expect(updates).not.toContain("reactorNames");
    expect(updates).not.toContain("reactorIds");
  });

  it("counts reactions in one query rather than one per update", () => {
    const list = updates.slice(updates.indexOf("export async function listEventUpdates"));
    expect(list).toContain('.in("event_update_id", updateIds)');
  });
});

describe("Update fanout is a job, not a request", () => {
  const fan = handlers.slice(handlers.indexOf("export const handleEventUpdateFanout"));

  it("registers the job type and its handler together", () => {
    // Worker support must exist before anything can enqueue the type -- the
    // lesson the Plans dead-letter incident taught.
    expect(jobRules).toContain('"events.update_fanout"');
    expect(handlers).toContain('"events.update_fanout": handleEventUpdateFanout');
  });

  it("enqueues with a deterministic key so a retry cannot double-fan", () => {
    expect(updates).toContain("event-update-fanout:");
  });

  it("resolves recipients at delivery, not at enqueue", () => {
    expect(fan).toContain('.from("event_rsvps")');
    expect(fan).toContain('.eq("status", "going")');
  });

  it("notifies Going only, never Interested", () => {
    expect(fan).not.toContain('"interested"');
  });

  it("never notifies the author about their own announcement", () => {
    expect(fan).toContain("id !== update.author_id");
  });

  it("stops for a cancelled Event", () => {
    expect(fan).toContain('event.status === "cancelled"');
  });

  it("delivers in bounded batches rather than one unbounded burst", () => {
    expect(fan).toContain("const BATCH = 200");
    expect(fan).not.toMatch(/Promise\.all\(\s*recipients/);
  });

  it("resumes from a cursor so a retry does not re-notify", () => {
    expect(fan).toContain("deliveredCount");
    // A transient code retries with backoff; a permanent one would dead-letter
    // a fanout that is merely unfinished.
    expect(fan).toContain('"RATE_LIMITED"');
  });

  it("excludes blocked recipients, batched", () => {
    expect(fan).toContain("batchBlockedIds(");
  });

  it("deep-links to the exact Event", () => {
    expect(fan).toContain("event:${eventId}");
  });
});

describe("editing does not re-notify", () => {
  it("marks the Update edited instead of fanning out again", () => {
    /* People already told must not be told again because a word changed. */
    const edit = updates.slice(updates.indexOf("export async function editEventUpdate"));
    expect(edit).toContain("edited_at");
    expect(edit).not.toContain("enqueueUpdateFanout");
  });
});

describe("transports share one authority", () => {
  it("keeps the web actions as thin wrappers", () => {
    for (const fn of ["createEventUpdate", "setUpdateReaction", "addEventAdmin", "removeEventAdmin"]) {
      expect(actions, fn + " must be delegated, not reimplemented").toContain(fn);
    }
    // No permission logic in the action layer.
    expect(actions).not.toContain("host_id ===");
  });
});
