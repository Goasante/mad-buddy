import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { stripComments } from "@/lib/content/strip-comments";

/**
 * Event presence privacy + the Event Glow N+1 (Plans + Events, Stage E).
 *
 * Source-text assertions, the same pattern rsvp-and-agenda.test.ts uses: this
 * code is server-only and admin-client-backed, with no DOM and no live
 * database under vitest's node environment.
 *
 * EVERY assertion runs against comment-stripped source. Stage E's whole
 * subject is the words "default", "false" and "opt-in", which appear in the
 * explanatory comments too -- asserting against raw text would let a comment
 * satisfy a test about behaviour.
 */

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const service = stripComments(read("lib/events/service.ts"));
const mobile = stripComments(read("lib/events/mobile.ts"));
const actions = stripComments(read("app/(app)/event-actions.ts"));
const checkinRoute = stripComments(read("app/api/events/[id]/checkin/route.ts"));
const scanActions = stripComments(read("app/(app)/scan-actions.ts"));
const eventsPage = stripComments(read("components/events/events-page.tsx"));
/* The check-in UI moved out of events-page.tsx in the Events 2.0 visual
 * rebuild: the page routes between surfaces now, and EventDetail renders the
 * Event itself. The privacy rules below are unchanged -- only their address. */
const eventDetail = stripComments(read("components/events/event-detail.tsx"));
const permissions = stripComments(read("lib/social/permissions.ts"));
const migration = read("supabase/migrations/20260811140000_event_presence_privacy.sql");

/**
 * SQL comments, not JS ones -- stripComments only knows `//` and `/* *\/`.
 *
 * This matters more than it looks: the migration's rollback block quotes the
 * OLD policy verbatim, so `'private'`, `set default true` and the owner policy
 * name all appear in the file as commented-out text. Asserting against raw
 * source would fail on the documentation while a genuinely broken migration
 * could still pass.
 */
const migrationSql = migration
  .split("\n")
  .filter((line) => !line.trim().startsWith("--"))
  .join("\n");

// ---------------------------------------------------------------------------
// Presence is opt-in on every write path
// ---------------------------------------------------------------------------

describe("event check-in never defaults to sharing presence", () => {
  it("has no write path that sets event_glow_enabled to a literal true", () => {
    // The bug this pins: three separate insert paths existed and two of them
    // wrote `event_glow_enabled: true` unconditionally.
    for (const [name, source] of [
      ["service", service],
      ["mobile", mobile],
      ["actions", actions]
    ] as const) {
      expect(`${name}: ${source}`).not.toMatch(/event_glow_enabled:\s*true/);
    }
  });

  it("defaults the server action's flag to false, not true", () => {
    expect(actions).toMatch(/event_glow_enabled:\s*parsed\.data\.eventGlowEnabled\s*\?\?\s*false/);
  });

  it("defaults the mobile check-in parameter to false", () => {
    expect(mobile).toMatch(/eventGlowEnabled\s*=\s*false/);
    expect(mobile).toMatch(/event_glow_enabled:\s*eventGlowEnabled/);
  });

  it("only turns presence on for a literal true from the mobile API body", () => {
    // A malformed body, a string "true", or a missing body must all mean off.
    expect(checkinRoute).toMatch(/eventGlowEnabled\s*===\s*true/);
  });

  it("leaves the QR scan path on the private default", () => {
    // Scanning a code is not an answer to the presence question, so the scan
    // path must not pass the flag at all.
    expect(scanActions).toContain("checkInToEventAction({ eventId: payload.contextId, token: code })");
    expect(scanActions).not.toContain("eventGlowEnabled");
  });
});

describe("the check-in UI asks before sharing presence", () => {
  it("passes the person's actual answer rather than a hardcoded value", () => {
    expect(eventsPage).toMatch(/function checkIn\(event: EventView, sharePresence: boolean\)/);
    expect(eventsPage).toMatch(/eventGlowEnabled:\s*sharePresence/);
    expect(eventsPage).toMatch(/myGlowEnabled:\s*sharePresence/);
  });

  it("starts the opt-in unticked", () => {
    // useState(false), explicitly. An empty useState() would leave the tick
    // undefined, which reads as unchecked but submits as falsy-by-accident
    // rather than by decision.
    expect(eventDetail).toMatch(/const \[sharePresence, setSharePresence\] = useState\(false\)/);
  });

  it("cannot carry one Event's answer into the next", () => {
    /* GUARANTEE, NOT MECHANISM. The old modal tracked presenceEventId and
     * cleared the tick whenever it changed. EventDetail instead owns the state
     * and is unmounted whenever the sheet closes, so every Event mounts a fresh
     * `false`.
     *
     * What must hold either way: the tick is component-local and initialised
     * false, never lifted into the page where it would outlive the Event it was
     * answered for. */
    expect(eventDetail).toMatch(/const \[sharePresence, setSharePresence\] = useState\(false\)/);
    expect(eventsPage).not.toContain("setSharePresence");
    // And the sheet is genuinely conditional, so closing it really unmounts.
    expect(eventsPage).toMatch(/\{selectedEvent \? \(\s*<EventDetail/);
  });

  it("labels the control in the words the product promises", () => {
    expect(eventDetail).toContain("Let my Muddies see I am here");
    // Names the audience, so "see I am here" cannot be read as "everyone".
    expect(eventDetail).toContain("Only Muddies who are also checked in");
  });

  it("passes the person's actual answer to check-in, never a hardcoded true", () => {
    expect(eventDetail).toContain("onCheckIn(sharePresence)");
    expect(eventDetail).not.toContain("onCheckIn(true)");
  });
});

// ---------------------------------------------------------------------------
// The Event Glow N+1
// ---------------------------------------------------------------------------

describe("buildEventGlowList resolves eligibility in batch", () => {
  it("makes no per-candidate permission call inside the loop", () => {
    // The bug: areApprovedMuddies + isBlockedEitherDirection were awaited once
    // per candidate, so an event with N attendees cost 2N round trips.
    expect(service).not.toContain("areApprovedMuddies(admin");
    expect(service).not.toContain("isBlockedEitherDirection(admin");
  });

  it("hoists both lookups above the loop", () => {
    const batchAt = service.indexOf("batchMutualMuddyIds(admin");
    const loopAt = service.indexOf("for (const candidate of candidates)");
    expect(batchAt).toBeGreaterThan(-1);
    expect(loopAt).toBeGreaterThan(-1);
    expect(batchAt).toBeLessThan(loopAt);
    expect(service.indexOf("batchBlockedIds(admin")).toBeLessThan(loopAt);
  });

  it("keeps muddy-ness and blocking as separate facts", () => {
    // resolveEventGlow reports "blocked" and "not_muddies" distinctly, so the
    // combined helper (batchEligibleMuddyIds) must NOT be what feeds it.
    expect(service).not.toContain("batchEligibleMuddyIds");
    expect(service).toMatch(/areApprovedMuddies:\s*mutual/);
    expect(service).toMatch(/isBlockedEitherDirection:\s*blocked/);
  });
});

describe("batchMutualMuddyIds matches the single-candidate helper it replaces", () => {
  it("uses the same active-friendship definition as areApprovedMuddies", () => {
    const start = permissions.indexOf("export async function batchMutualMuddyIds");
    expect(start).toBeGreaterThan(-1);
    const body = permissions.slice(start, permissions.indexOf("export async function", start + 1));
    expect(body).toContain('.from("friendships")');
    // ended_at is null is the canonical definition of "currently Muddies";
    // dropping it would resurrect removed friendships as present Muddies.
    expect(body).toContain('.is("ended_at", null)');
    // Symmetric: friendships store one row, either column order.
    expect(body).toContain("user_one_id.eq.");
    expect(body).toContain("user_two_id.eq.");
  });

  it("never reports the viewer as their own Muddy", () => {
    const start = permissions.indexOf("export async function batchMutualMuddyIds");
    const body = permissions.slice(start, permissions.indexOf("export async function", start + 1));
    expect(body).toContain("id !== viewerId");
  });
});

// ---------------------------------------------------------------------------
// The migration
// ---------------------------------------------------------------------------

describe("the Stage E migration closes both privacy gaps", () => {
  it("flips the column default to false", () => {
    expect(migrationSql).toMatch(
      /alter column event_glow_enabled set default false/
    );
    expect(migrationSql).not.toMatch(/set default true/);
  });

  it("narrows the host policy to attendees who accepted being named", () => {
    expect(migrationSql).toContain("check ins readable by event host");
    expect(migrationSql).toMatch(/visibility in \('participants', 'selected_muddies'\)/);
    // The two settings that mean "don't name me" must not be readable.
    expect(migrationSql).not.toContain("'private'");
    expect(migrationSql).not.toContain("'anonymous_count'");
  });

  it("keeps the host policy scoped to the host's own event", () => {
    // Narrowing must not accidentally widen: the events join stays.
    expect(migrationSql).toContain("e.host_id = auth.uid()");
    expect(migrationSql).toContain("context_type = 'event'");
  });

  it("does not rewrite historical rows", () => {
    // Past check-ins record what was true when written. A bulk update would
    // falsify that, and was explicitly ruled out.
    expect(migrationSql).not.toMatch(/\bupdate\s+public\.check_ins/i);
    expect(migrationSql).not.toMatch(/\bdelete\s+from\b/i);
  });

  it("leaves the owner's own access untouched", () => {
    expect(migrationSql).not.toContain("check ins owner full access");
  });

  it("documents a rollback", () => {
    expect(migration).toContain("Rollback:");
  });
});
