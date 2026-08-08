import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  collectFriendshipQuerySites,
  undeclaredFriendshipDeletes,
  HARD_DELETE_ANNOTATION
} from "@/lib/life/friendship-query-guard";
import { buildLifeEvent, LIFE_EVENT_CLASSIFICATION } from "@/lib/life/events";
import { buildTimeline, timelineFacts, type TimelineSourceRow } from "@/lib/life/timeline";
import { stripComments } from "@/lib/content/strip-comments";

/**
 * Phase 3.2B — the relationship lifecycle.
 *
 * The property under test throughout: A RELATIONSHIP IS A PERSISTENT IDENTITY.
 * It can end, it can restart, and neither event may destroy or duplicate it.
 */

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const ALICE = "11111111-1111-4111-8111-111111111111";
const BOB = "22222222-2222-4222-8222-222222222222";

const actions = stripComments(read("app/(app)/actions.ts"));
const friendsService = stripComments(read("lib/friends/service.ts"));
const lifecycleMigration = read("supabase/migrations/20260806240000_relationship_lifecycle.sql");
const initialSchema = read("supabase/migrations/20260709100000_initial_schema.sql");
const rebuild = stripComments(read("lib/life/rebuild.ts"));

/**
 * The source of one exported action, from its declaration to the next one.
 *
 * Anchored on `export async function NAME`, not the bare name: the name also
 * appears in the import list at the top of the file, and slicing from there
 * would scope an assertion to the whole module and quietly pass on code from
 * an unrelated action.
 */
function functionBody(name: string): string {
  const start = actions.indexOf(`export async function ${name}`);
  expect(start, `${name} not found`).toBeGreaterThan(-1);
  const next = actions.indexOf("export async function ", start + 1);
  return actions.slice(start, next === -1 ? undefined : next);
}

// ---------------------------------------------------------------------------
// Stage 1 — soft ending
// ---------------------------------------------------------------------------

describe("soft ending", () => {
  it("removeFriendAction sets ended_at instead of deleting", () => {
    const scoped = functionBody("removeFriendAction");
    expect(scoped).toContain('.update({ ended_at: endedAt })');
    // The action still deletes close-friend rows, which is correct — those are
    // a private setting, not the relationship. Only the friendships table must
    // survive, so the assertion is scoped to that table rather than to the
    // word "delete".
    const friendshipsChain = scoped.slice(scoped.indexOf('.from("friendships")'));
    expect(friendshipsChain.slice(0, 300)).not.toContain(".delete()");
  });

  it("only ends a currently-active friendship, so a repeat cannot re-stamp it", () => {
    // Two concurrent removals must not move the ending later than it happened.
    const body = actions.slice(actions.indexOf("removeFriendAction"));
    expect(body.slice(0, body.indexOf("blockUserAction"))).toContain('.is("ended_at", null)');
  });

  it("blocking ends the friendship rather than erasing it", () => {
    const body = functionBody("blockUserAction");
    expect(body).toContain('.update({ ended_at: blockedAt })');
  });

  it("no friendship hard delete survives outside account erasure", () => {
    const undeclared = undeclaredFriendshipDeletes(collectFriendshipQuerySites(process.cwd()));
    expect(
      undeclared.map((site) => `${site.file}:${site.line}`),
      `A DELETE destroys relationship identity. Soft-end with ended_at, or annotate ${HARD_DELETE_ANNOTATION} if this really is erasure.`
    ).toEqual([]);
  });

  it("account deletion still hard-deletes, because erasure must erase", () => {
    const settings = read("app/(app)/settings-actions.ts");
    expect(settings).toContain(HARD_DELETE_ANNOTATION);
    expect(settings).toContain('admin.from("friendships").delete()');
  });
});

// ---------------------------------------------------------------------------
// Stage 2 — reactivation
// ---------------------------------------------------------------------------

describe("reactivation", () => {
  it("an ended friendship no longer blocks a new request", () => {
    // The trigger previously rejected a request whenever ANY row existed,
    // which made a soft ending permanent and reactivation unreachable.
    const trigger = lifecycleMigration.slice(
      lifecycleMigration.indexOf("prevent_pending_request_for_existing_friendship")
    );
    expect(trigger.slice(0, trigger.indexOf("$$;"))).toContain("friendship.ended_at is null");
  });

  it("acceptance reactivates the existing row rather than inserting a second", () => {
    expect(lifecycleMigration).toContain("on conflict (user_one_id, user_two_id)");
    expect(lifecycleMigration).toContain("ended_at = null");
  });

  it("the RPC reports whether it reactivated", () => {
    expect(lifecycleMigration).toContain("reactivated boolean");
  });

  it("emits reactivated, not created, when a relationship resumes", () => {
    expect(friendsService).toContain('request.reactivated ? "relationship.reactivated" : "relationship.created"');
  });

  it("gives each reactivation its own dedupe key", () => {
    // A pair is created once but may reactivate many times. A fixed key would
    // collapse every later reactivation into the first.
    const first = buildLifeEvent({
      eventType: "relationship.reactivated",
      actorId: ALICE,
      subjectId: BOB,
      naturalKey: "reactivated:request-1"
    });
    const second = buildLifeEvent({
      eventType: "relationship.reactivated",
      actorId: ALICE,
      subjectId: BOB,
      naturalKey: "reactivated:request-2"
    });
    expect(first.dedupeKey).not.toBe(second.dedupeKey);
  });

  it("keeps the relationship id stable across an ending and a restart", () => {
    // The identity that must survive: same pair, same resource id, whatever
    // happened in between.
    const created = buildLifeEvent({ eventType: "relationship.created", actorId: ALICE, subjectId: BOB, naturalKey: "created" });
    const ended = buildLifeEvent({ eventType: "relationship.ended", actorId: BOB, subjectId: ALICE, naturalKey: "ended" });
    const back = buildLifeEvent({ eventType: "relationship.reactivated", actorId: ALICE, subjectId: BOB, naturalKey: "reactivated:r1" });
    expect(new Set([created.resourceId, ended.resourceId, back.resourceId]).size).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Stage 3 — relationship identity
// ---------------------------------------------------------------------------

describe("relationship identity", () => {
  it("the database allows exactly one row per pair", () => {
    expect(initialSchema).toContain("friendships_unique_pair unique (user_one_id, user_two_id)");
  });

  it("the pair has one canonical orientation", () => {
    // Without this, (A,B) and (B,A) would both be insertable and the unique
    // constraint would not actually constrain anything.
    expect(initialSchema).toContain("friendships_ordered check (user_one_id < user_two_id)");
  });

  it("concurrent acceptances serialise on the row lock", () => {
    // Two simultaneous accepts must not both report a reactivation.
    expect(lifecycleMigration).toContain("for update");
  });

  it("introduces no parallel identity table", () => {
    expect(lifecycleMigration.toLowerCase()).not.toContain("create table");
  });
});

// ---------------------------------------------------------------------------
// Stage 4 — event emission
// ---------------------------------------------------------------------------

describe("lifecycle event emission", () => {
  it("ending emits relationship.ended with the real ending time", () => {
    const scoped = functionBody("removeFriendAction");
    expect(scoped).toContain('eventType: "relationship.ended"');
    expect(scoped).toContain("occurredAt: endedAt");
  });

  it("blocking also records an ending", () => {
    const body = functionBody("blockUserAction");
    expect(body).toContain('eventType: "relationship.ended"');
  });

  it("blocking's event never says a block caused it", () => {
    // The timeline is shared with the other party; "they blocked you" is not a
    // fact either side may read out of a projection.
    const body = functionBody("blockUserAction");
    // Just the emitted object literal, not the code around it — the action is
    // *about* blocking, so its surroundings mention it freely. What matters is
    // that no blocking detail rides along in the event payload.
    const start = body.indexOf('eventType: "relationship.ended"');
    const emission = body.slice(start, body.indexOf("});", start));
    // No payload at all: the event states that the relationship ended and
    // nothing more. `blockedAt` is only the timestamp, which is the same fact
    // an ordinary removal records.
    expect(emission).not.toContain("payload");
    expect(emission).not.toContain("reason");
    // And the event type itself is a plain ending, not a block-flavoured one.
    expect(emission).toContain('eventType: "relationship.ended"');
  });

  it("both endings share a dedupe key, so blocking someone removed adds nothing", () => {
    const removed = buildLifeEvent({ eventType: "relationship.ended", actorId: ALICE, subjectId: BOB, naturalKey: "ended" });
    const blocked = buildLifeEvent({ eventType: "relationship.ended", actorId: ALICE, subjectId: BOB, naturalKey: "ended" });
    expect(removed.dedupeKey).toBe(blocked.dedupeKey);
  });

  it("emission is compensating — never awaited into the action's result", () => {
    // `void` is the marker: a failed event must never roll back the ending.
    expect(actions).toContain("void emitLifeEvent(admin, {");
  });

  it("emits after the write has already committed", () => {
    const scoped = functionBody("removeFriendAction");
    expect(scoped.indexOf(".update({ ended_at: endedAt })")).toBeLessThan(
      scoped.indexOf("emitLifeEvent")
    );
  });
});

// ---------------------------------------------------------------------------
// Stage 5 — legacy compatibility
// ---------------------------------------------------------------------------

describe("creation paths", () => {
  it("acceptance is the only path that creates a friendship", () => {
    // Invites and QR scans create a REQUEST, so every creation converges on
    // the RPC and inherits its reactivation semantics for free.
    const invites = stripComments(read("app/(app)/invite-actions.ts"));
    expect(invites).not.toContain('from("friendships")');
  });

  it("the accept service emits a Life event for a first-time creation", () => {
    expect(friendsService).toContain('"relationship.created"');
  });
});

// ---------------------------------------------------------------------------
// Stage 6 — rebuild and replay
// ---------------------------------------------------------------------------

describe("rebuild", () => {
  it("still replays ended relationships", () => {
    expect(rebuild).toContain('eventType: "relationship.ended"');
  });

  it("does not invent reactivation dates the row never stored", () => {
    // One row carries one ended_at, so a reactivated pair is indistinguishable
    // from a never-ended one. Guessing would fabricate history.
    expect(rebuild).not.toContain('"relationship.reactivated"');
  });

  it("projects the same timeline regardless of replay order", () => {
    const rows: TimelineSourceRow[] = [
      { eventType: "relationship.created", actorId: ALICE, occurredAt: "2026-01-01T00:00:00.000Z", payload: { subjectId: BOB } },
      { eventType: "relationship.ended", actorId: BOB, occurredAt: "2026-02-01T00:00:00.000Z", payload: { subjectId: ALICE } },
      { eventType: "relationship.reactivated", actorId: ALICE, occurredAt: "2026-03-01T00:00:00.000Z", payload: { subjectId: BOB } },
      { eventType: "plan.attended_together", actorId: ALICE, occurredAt: "2026-04-01T00:00:00.000Z", payload: { subjectId: BOB } }
    ];
    const forward = buildTimeline(rows, ALICE).entries.map((entry) => entry.occurredAtMs);
    const reversed = buildTimeline([...rows].reverse(), ALICE).entries.map((entry) => entry.occurredAtMs);
    expect(forward).toEqual(reversed);
  });

  it("reports a reactivated pair as active, not ended", () => {
    const rows: TimelineSourceRow[] = [
      { eventType: "relationship.created", actorId: ALICE, occurredAt: "2026-01-01T00:00:00.000Z", payload: { subjectId: BOB } },
      { eventType: "relationship.ended", actorId: BOB, occurredAt: "2026-02-01T00:00:00.000Z", payload: { subjectId: ALICE } },
      { eventType: "relationship.reactivated", actorId: ALICE, occurredAt: "2026-03-01T00:00:00.000Z", payload: { subjectId: BOB } }
    ];
    const facts = timelineFacts(buildTimeline(rows, ALICE).entries);
    expect(facts.endedAtMs).toBeNull();
    expect(facts.createdAtMs).not.toBeNull();
  });

  it("survives multiple cycles, keeping the original creation date", () => {
    // Continuity is the point: reactivation resumes a relationship, so its
    // beginning stays where it was.
    const rows: TimelineSourceRow[] = [
      { eventType: "relationship.created", actorId: ALICE, occurredAt: "2026-01-01T00:00:00.000Z", payload: { subjectId: BOB } },
      { eventType: "relationship.ended", actorId: BOB, occurredAt: "2026-02-01T00:00:00.000Z", payload: { subjectId: ALICE } },
      { eventType: "relationship.reactivated", actorId: ALICE, occurredAt: "2026-03-01T00:00:00.000Z", payload: { subjectId: BOB } },
      { eventType: "relationship.ended", actorId: ALICE, occurredAt: "2026-04-01T00:00:00.000Z", payload: { subjectId: BOB } },
      { eventType: "relationship.reactivated", actorId: BOB, occurredAt: "2026-05-01T00:00:00.000Z", payload: { subjectId: ALICE } }
    ];
    const facts = timelineFacts(buildTimeline(rows, ALICE).entries);
    expect(facts.createdAtMs).toBe(Date.parse("2026-01-01T00:00:00.000Z"));
    expect(facts.endedAtMs).toBeNull();
  });

  it("a duplicate replay adds nothing, because the dedupe key is stable", () => {
    const once = buildLifeEvent({ eventType: "relationship.ended", actorId: ALICE, subjectId: BOB, naturalKey: "ended", occurredAt: "2026-02-01T00:00:00.000Z" });
    const again = buildLifeEvent({ eventType: "relationship.ended", actorId: BOB, subjectId: ALICE, naturalKey: "ended", occurredAt: "2026-02-01T00:00:00.000Z" });
    expect(once.dedupeKey).toBe(again.dedupeKey);
  });
});

// ---------------------------------------------------------------------------
// Stage 7 — privacy
// ---------------------------------------------------------------------------

describe("privacy", () => {
  it("a removed Muddy regains nothing until the relationship is reactivated", () => {
    // Access is revoked the instant ended_at is set, because every
    // active-friend read filters on it (proven exhaustively by the query
    // guard). Reactivation is the only thing that clears it.
    const guard = collectFriendshipQuerySites(process.cwd()).filter(
      (site) => site.kind === "read" && !site.hasEndedFilter && !site.annotatedHistorical
    );
    expect(guard).toEqual([]);
    expect(lifecycleMigration).toContain("ended_at = null");
  }, 15_000);

  it("reactivation is not AI-readable", () => {
    expect(LIFE_EVENT_CLASSIFICATION["relationship.reactivated"].aiEligible).toBe(false);
  });

  it("lifecycle events carry no free text", () => {
    // A payload key like `reason` would invite recording why someone was
    // removed, which is not a fact the other party may read.
    expect(() =>
      buildLifeEvent({
        eventType: "relationship.ended",
        actorId: ALICE,
        subjectId: BOB,
        naturalKey: "ended",
        payload: { note: "we fell out" }
      })
    ).toThrow();
  });

  it("a timeline reset still hides everything before the cut-off", () => {
    // Ending and reactivation must not resurrect events the owner cleared.
    const rows: TimelineSourceRow[] = [
      { eventType: "relationship.created", actorId: ALICE, occurredAt: "2026-01-01T00:00:00.000Z", payload: { subjectId: BOB } },
      { eventType: "relationship.reactivated", actorId: ALICE, occurredAt: "2026-03-01T00:00:00.000Z", payload: { subjectId: BOB } }
    ];
    const { entries } = buildTimeline(rows, ALICE, {
      hiddenBeforeMs: Date.parse("2026-02-01T00:00:00.000Z")
    });
    expect(entries).toHaveLength(1);
  });

  it("Life stays unexposed — the lifecycle ships no UI", () => {
    // Life is emission-only in this phase. No route, no link, no navigation:
    // the events accumulate so the timeline is ready when it is switched on.
    expect(actions).not.toContain('href="/life');
    expect(actions).not.toContain('redirect("/life');
    expect(actions).not.toContain('revalidatePath("/life');
  });
});

// ---------------------------------------------------------------------------
// Stage 8 — what cannot be recovered
// ---------------------------------------------------------------------------

describe("migration honesty", () => {
  it("documents that pre-existing hard deletes are unrecoverable", () => {
    expect(lifecycleMigration).toContain("cannot be recovered");
  });

  it("backfills no fabricated history", () => {
    const lowered = lifecycleMigration.toLowerCase();
    expect(lowered).not.toContain("insert into public.domain_events");
  });
});
