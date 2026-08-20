import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { stripComments } from "@/lib/content/strip-comments";

/**
 * Event RSVP, the block-gap fix, and the personal upcoming agenda (Plans +
 * Events lifecycle, Stage C).
 *
 * Source-text assertions against the guarantees, the same pattern
 * lib/social/plan-lifecycle-surfaces.test.ts and lib/contacts already use in
 * this codebase: the domain code here is server-only and admin-client-backed,
 * with no DOM and no live database in this test environment
 * (vitest.config: environment: "node"). What is asserted is structural and
 * could not pass by accident.
 */

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const mobile = stripComments(read("lib/events/mobile.ts"));
const permissions = stripComments(read("lib/social/permissions.ts"));
const agenda = stripComments(read("lib/social/upcoming-agenda.ts"));
const migration = read("supabase/migrations/20260811130000_event_rsvps.sql");
const initialSchema = read("supabase/migrations/20260709100000_initial_schema.sql");
const eventsPage = stripComments(read("components/events/events-page.tsx"));
/* Events 2.0 visual rebuild: the page routes between four surfaces, each of
 * which derives its own rows, and the Event itself renders in EventDetail.
 * The rules below are unchanged -- only the file enforcing them. */
const detail = stripComments(read("components/events/event-detail.tsx"));
const presentation = stripComments(read("lib/events/presentation.ts"));
const hosting = stripComments(read("components/events/events-hosting.tsx"));
const yours = stripComments(read("components/events/events-yours.tsx"));

// ---------------------------------------------------------------------------
// The block gap: pre-existing, fixed in this stage
// ---------------------------------------------------------------------------

describe("the pre-existing block gap in listEvents is closed", () => {
  it("checks blocks before returning any event", () => {
    expect(mobile).toContain("batchBlockedIds(admin, userId, hostIdsToCheck)");
    // Applied as a filter, not merely computed and discarded.
    expect(mobile).toContain("!blockedHostIds.has(event.host_id)");
  });

  it("checks blocks BEFORE the expensive per-host reads, not after", () => {
    // Fails closed and cheaply: no point batching check-ins, profiles and
    // plans for a host the viewer cannot see anyway.
    const blockCheck = mobile.indexOf("batchBlockedIds(admin, userId, hostIdsToCheck)");
    const expensiveReads = mobile.indexOf('from("check_ins")');
    expect(blockCheck).toBeGreaterThan(-1);
    expect(blockCheck).toBeLessThan(expensiveReads);
  });

  it("reuses the canonical batched helper rather than a parallel query", () => {
    // The instruction was explicit: reuse isBlockedEitherDirection's
    // semantics, do not hand-roll a second blocked_users query in mobile.ts.
    expect(mobile).not.toMatch(/from\(["']blocked_users["']\)/);
    expect(mobile).toContain('from "@/lib/social/permissions"');
  });

  it("the batched helper matches isBlockedEitherDirection's own semantics exactly", () => {
    // Same table, same OR-both-directions shape, so a caller of either gets
    // the identical answer for the identical pair.
    const batched = permissions.slice(permissions.indexOf("export async function batchBlockedIds"));
    expect(batched.slice(0, 600)).toContain('from("blocked_users")');
    expect(batched.slice(0, 600)).toContain("blocker_id.eq.${viewerId},blocked_id.eq.${viewerId}");
  });

  it("is one query regardless of how many hosts are being checked", () => {
    // The N+1 this replaces: batchEligibleMuddyIds directly above it in the
    // same file already established this exact pattern for the identical
    // reason, and batchBlockedIds is deliberately shaped to match it.
    const batched = permissions.slice(permissions.indexOf("export async function batchBlockedIds"));
    const body = batched.slice(0, batched.indexOf("\n}"));
    expect((body.match(/\.from\(/g) ?? []).length).toBe(1);
  });

  it("excludes the viewer's own id from what it checks", () => {
    // Nobody can block themselves; blockedIds must not contain the viewer.
    const batched = permissions.slice(permissions.indexOf("export async function batchBlockedIds"));
    expect(batched.slice(0, 400)).toContain("filter((id) => id && id !== viewerId)");
  });
});

// ---------------------------------------------------------------------------
// setEventRsvp: server-authoritative mutation
// ---------------------------------------------------------------------------

describe("setEventRsvp validates everything a client could lie about", () => {
  const service = mobile.slice(mobile.indexOf("export async function setEventRsvp"));

  it("requires authentication and a real event id before anything else", () => {
    expect(service.slice(0, 400)).toContain("uuidSchema.safeParse(eventId)");
  });

  it("validates the status against the canonical enum, not a bare string", () => {
    expect(service.slice(0, 600)).toContain("rsvpStatusSchema.safeParse(status)");
  });

  it("checks the event exists and respects invite-only visibility", () => {
    expect(service).toContain('event.visibility === "invite" && event.host_id !== userId');
  });

  it("refuses a host RSVPing to their own event", () => {
    // Hosting and RSVPing are different concepts, per the spec decision:
    // a host is never asked to confirm they are going to their own event.
    expect(service).toContain("event.host_id === userId");
    const hostCheck = service.slice(service.indexOf("if (event.host_id === userId)"));
    expect(hostCheck.slice(0, 150)).toContain("You're hosting this event.");
  });

  it("checks the block relationship before allowing the mutation", () => {
    expect(service).toContain("isBlockedEitherDirection(admin, userId, event.host_id)");
    // Same information-leak avoidance every other blocked-access path in the
    // product uses: a blocked RSVP attempt gets the identical "not found"
    // message an actually-missing event would, never a message that confirms
    // the block exists.
    const blockCheck = service.slice(service.indexOf("isBlockedEitherDirection(admin, userId, event.host_id)"));
    expect(blockCheck.slice(0, 200)).toContain("Event not found.");
  });

  it("refuses a cancelled or draft event", () => {
    expect(service).toContain('event.status === "cancelled" || event.status === "draft"');
  });

  it("refuses an event that has already ended, via the canonical phase check", () => {
    // Not a re-derived "is it over" comparison -- the same eventPhase
    // boundary every other Event surface uses. Checked on the whole file:
    // the import lives at module scope, above where `service` is sliced from.
    expect(service).toContain("isPastEvent({ startsAtMs:");
    expect(mobile).toContain('from "@/lib/events/rules"');
    expect(mobile).toContain("isPastEvent");
  });

  it("rate limits the mutation", () => {
    expect(service).toContain('consumeRateLimit({ action: "events.rsvp", userId })');
  });

  it("upserts on the canonical unique constraint, never insert-then-update", () => {
    // This is what makes Going -> Going -> Going one row under a rapid
    // double-tap: the database enforces it, this just uses the right verb.
    expect(service).toContain('.upsert(');
    expect(service).toContain('{ onConflict: "event_id,user_id" }');
  });

  it("never targets another user's row", () => {
    // The upsert payload's user_id is always the authenticated userId
    // parameter, never anything the caller could substitute.
    const upsertCall = service.slice(service.indexOf(".upsert("));
    expect(upsertCall.slice(0, 200)).toContain("user_id: userId");
  });
});

// ---------------------------------------------------------------------------
// EventView / listEvents: the viewer's own RSVP, never another's
// ---------------------------------------------------------------------------

describe("listEvents projects only the viewer's own RSVP", () => {
  it("scopes the RSVP read to the authenticated user", () => {
    const rsvpRead = mobile.slice(mobile.indexOf('from("event_rsvps")'));
    expect(rsvpRead.slice(0, 200)).toContain('.eq("user_id", userId)');
  });

  it("never selects another user's rsvp column", () => {
    expect(mobile).not.toContain('.select("event_id, user_id, status")');
  });

  it("carries null for a host, never a fabricated row", () => {
    expect(mobile).toContain("myRsvp: rsvpStatus && isEventRsvpStatus(rsvpStatus) ? rsvpStatus : null");
  });
});

// ---------------------------------------------------------------------------
// The personal upcoming agenda
// ---------------------------------------------------------------------------

describe("the unified personal agenda", () => {
  it("reuses the canonical Home Plan loader rather than querying Plans twice", () => {
    expect(agenda).toContain("loadUpcomingPlans(userId, limit + 1)");
    expect(agenda).not.toContain('from("plan_participants")');
  });

  it("includes existing Interested and Going event intent", () => {
    expect(agenda).toContain('.in("status", ["interested", "going"])');
  });

  it("includes a hosted event without requiring an RSVP row", () => {
    expect(agenda).toContain('from("events").select("id").eq("host_id", userId)');
    const filter = agenda.slice(agenda.indexOf(".filter((event) => {"));
    expect(filter.slice(0, 400)).toContain("if (event.host_id === userId) return true;");
  });

  it("never includes Not Going intent", () => {
    const inclusion = agenda.slice(agenda.indexOf('.in("status", ["interested", "going"])'));
    expect(inclusion.slice(0, 80)).not.toContain("not_going");
  });

  it("re-checks RSVP status at read time rather than trusting the seed list", () => {
    // A Going -> Not Going change since goingEventIds was read must not
    // leave a stale entry in this request's agenda.
    const filter = agenda.slice(agenda.indexOf(".filter((event) => {"));
    expect(filter.slice(0, 600)).toContain('rsvp === "interested" || rsvp === "going"');
  });

  it("keeps a currently-live event in the agenda, not only strictly-upcoming", () => {
    // The spec decision: a 7-11pm event does not vanish from the agenda at
    // 7:01, mirroring Stage A's rule for an in-progress Plan with an end time.
    const filter = agenda.slice(agenda.indexOf(".filter((event) => {"));
    expect(filter.slice(0, 600)).toContain('phase === "upcoming" || phase === "live"');
  });

  it("excludes past and cancelled events at the query level too", () => {
    expect(agenda).toContain('.in("status", ["scheduled", "active"])');
    expect(agenda).toContain('.gte("ends_at", nowIso)');
  });

  it("applies the same block check as listEvents, via the same batched helper", () => {
    expect(agenda).toContain("batchBlockedIds(admin, userId, hostIdsToCheck)");
    expect(agenda).toContain('from "@/lib/social/permissions"');
  });

  it("never excludes the viewer's own hosted events via the block filter", () => {
    const filter = agenda.slice(agenda.indexOf("const accessible = rows.filter"));
    expect(filter.slice(0, 150)).toContain("event.host_id === userId ||");
  });

  it("hands both domains to the pure chronological projection", () => {
    expect(agenda).toContain("projectUpcomingAgenda(merged, nowMs, limit)");
  });
});

// ---------------------------------------------------------------------------
// The events-page phase bug: fixed
// ---------------------------------------------------------------------------

describe("the Events page Upcoming tab no longer includes Past", () => {
  it("no longer defines the old isLive function", () => {
    expect(eventsPage).not.toContain("function isLive(event: EventView, nowMs: number): boolean");
  });

  it("buckets every tab through the canonical eventPhase", () => {
    expect(eventsPage).toContain('from "@/lib/events/rules"');
    expect(eventsPage).toContain("eventPhase(");
  });

  it("derives live and past from the canonical phase, never from not-live", () => {
    /* One derivation, in presentation.ts, consumed by every surface. The bug
     * this replaces treated "not currently live" as upcoming, which quietly
     * swept finished Events into the Upcoming list. */
    expect(presentation).toContain('isLive: phase === "live"');
    expect(presentation).toContain('isPast: phase === "past"');
    expect(presentation).toContain('from "@/lib/events/rules"');
    expect(presentation).not.toContain("!isLive(");
  });

  it("gives no surface its own private copy of that rule", () => {
    // Each surface asks describeEvent rather than re-deriving from timestamps.
    for (const [name, source] of [["hosting", hosting], ["yours", yours]] as const) {
      expect(source, name).toContain("describeEvent(");
      expect(source, name).not.toContain("Date.now()");
    }
  });
});

// ---------------------------------------------------------------------------
// RSVP UI
// ---------------------------------------------------------------------------

describe("the Event detail RSVP controls", () => {
  it("offers Interested, Going and Not going, changeable in any direction", () => {
    for (const status of ['"interested"', '"going"', '"not_going"']) {
      expect(detail, status).toContain(`status: ${status}`);
    }
    // One handler for all three: there is no separate un-RSVP path.
    expect(detail).toContain("onRsvp(choice.status)");
  });

  it("shows a host no RSVP control at all", () => {
    /* Hosting is derived from isHost, never stored as intent to attend one's
     * own Event -- and setEventRsvp refuses a host server-side, so offering the
     * control would only ever produce a refusal. */
    expect(detail).toContain("{event.isHost ? null : checkedIn ? (");
    const hero = detail.slice(detail.indexOf('{[event.isHost ? "You are hosting"'));
    expect(hero.slice(0, 200)).toContain("You are hosting");
  });

  it("marks the chosen RSVP as a real selection, not only a colour", () => {
    /* SUPERSEDED DELIBERATELY (Events 2.0 visual rebuild). This asserted the
     * Plans pattern of three primary/outline Buttons. The approved design uses
     * one segmented control, which fits a single-choice answer better AND is a
     * better accessibility story: three independent buttons cannot say which
     * one is chosen, whereas a radiogroup does.
     *
     * The invariant that survives the restyle is the one that matters -- the
     * selection is announced, not merely painted. */
    const rsvpBlock = detail.slice(detail.indexOf('id="event-rsvp"'));
    expect(rsvpBlock.slice(0, 1200)).toContain('role="radiogroup"');
    expect(rsvpBlock.slice(0, 1600)).toContain('role="radio"');
    expect(rsvpBlock.slice(0, 1600)).toContain("aria-checked={selected}");
    expect(rsvpBlock.slice(0, 1600)).toContain("const selected = event.myRsvp === choice.status;");
  });

  it("does not invent a new haptic system", () => {
    expect(eventsPage).not.toContain("haptic(");
  });

  it("shows Going as a state on personal lists rather than as a control", () => {
    /* On Your Events the answer is already given, so three competing buttons
     * per row would be noise. Changing it happens on the Event's own screen. */
    /* The mark now depends on the RELATIONSHIP, because a host has one too --
       and it must never read "Going". relationshipMark decides between
       Hosting, Going and nothing. */
    expect(yours).toContain("relationshipMark(event, tab)");
    expect(yours).toContain('if (event.isHost) return <HostingMark />;');
    expect(yours).toContain('event.myRsvp === "going" && tab !== "past"');
    expect(yours).not.toContain('role="radiogroup"');
  });
});

// ---------------------------------------------------------------------------
// The migration
// ---------------------------------------------------------------------------

describe("event_rsvps migration", () => {
  it("defines the table additively, not replacing anything", () => {
    expect(migration).toContain("create table if not exists public.event_rsvps");
    expect(migration).not.toContain("drop table");
    expect(migration).not.toContain("alter table public.events");
  });

  it("enforces the canonical status enum", () => {
    expect(migration).toContain("check (status in ('interested', 'going', 'not_going'))");
  });

  it("cascades on both foreign keys", () => {
    expect(migration).toContain("references public.events(id) on delete cascade");
    expect(migration).toContain("references auth.users(id) on delete cascade");
  });

  it("has exactly one row per (event_id, user_id)", () => {
    expect(migration).toContain("constraint event_rsvps_unique unique (event_id, user_id)");
  });

  it("indexes both directions of lookup", () => {
    expect(migration).toContain("event_rsvps_user_status_idx on public.event_rsvps(user_id, status)");
    expect(migration).toContain("event_rsvps_event_status_idx on public.event_rsvps(event_id, status)");
  });

  it("reuses the canonical updated_at trigger, not a second convention", () => {
    expect(migration).toContain("execute function public.set_updated_at()");
    // The function itself must actually exist in the schema this depends on.
    expect(initialSchema).toContain("create or replace function public.set_updated_at()");
  });

  it("enables RLS and restricts every policy to the row owner", () => {
    expect(migration).toContain("alter table public.event_rsvps enable row level security");
    expect(migration).toContain('for select using (auth.uid() = user_id)');
    expect(migration).toContain('for insert with check (auth.uid() = user_id)');
    expect(migration).toContain('for update using (auth.uid() = user_id) with check (auth.uid() = user_id)');
  });

  it("gives the host no special RLS override", () => {
    // Checked against actual SQL, not the migration's own explanatory prose,
    // which legitimately discusses host_id when describing what this
    // deliberately does NOT grant.
    const sqlOnly = migration
      .split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n");
    expect(sqlOnly).not.toContain("host_id");
    expect(sqlOnly.toLowerCase()).not.toContain("host full access");
    // Exactly three policies: owner select, owner insert, owner update.
    expect((migration.match(/create policy/g) ?? []).length).toBe(3);
  });

  it("has no delete policy: not_going is stored, not removed", () => {
    expect(migration).not.toMatch(/for delete/);
  });

  it("does not touch check_ins in any way", () => {
    expect(migration).not.toContain("check_ins");
    expect(migration).not.toContain("event_glow_enabled");
    expect(migration).not.toContain("checkin_opens_minutes_before");
  });
});
