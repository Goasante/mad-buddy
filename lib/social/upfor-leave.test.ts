import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { stripComments } from "@/lib/content/strip-comments";
import { applyUpForFilters, hasSpace, isJoined } from "@/lib/social/upfor-filters";

/**
 * Stage 3 guards: the ended-friendship RLS gap, and withdrawing.
 *
 * The RLS assertions read the migration rather than a live database. That is
 * the project's existing pattern for policy work, and it pins the property
 * that matters — the predicate the policy actually applies.
 */

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const migration = read("supabase/migrations/20260808160000_upfor_rls_and_leave.sql");
const actions = stripComments(read("app/(app)/hangout-actions.ts"));
const page = stripComments(read("components/hangout/hangout-mode-page.tsx"));

const leaveAction = actions.slice(actions.indexOf("export async function leaveHangoutAction"));

// ---------------------------------------------------------------------------
// 1. The ended-friendship gap
// ---------------------------------------------------------------------------

describe("an ended friendship cannot read an active UpFor", () => {
  const policy = migration.slice(migration.indexOf('create policy "muddies read active hangouts"'));
  const body = policy.slice(0, policy.indexOf(");"));

  it("requires ended_at IS NULL in the read policy", () => {
    // Since Phase 3.2A, ended_at IS NULL is the canonical definition of
    // "currently Muddies": a soft-ended friendship keeps its row, so "a row
    // exists" and "they are friends" stopped being the same question.
    expect(policy).toContain("f.ended_at is null");
  });

  it("still requires an active, unexpired session", () => {
    // The fix narrows access; it must not drop the other conditions.
    expect(body).toContain("status = 'active'");
    expect(body).toContain("ends_at > now()");
  });

  it("keeps the friendship check bidirectional, so an active pair still reads", () => {
    expect(body).toContain("f.user_one_id = auth.uid()");
    expect(body).toContain("f.user_two_id = auth.uid()");
  });

  it("replaces the policy rather than adding a second permissive one", () => {
    // Postgres ORs permissive SELECT policies, so adding one alongside the old
    // one would leave the gap wide open.
    expect(migration).toContain('drop policy if exists "muddies read active hangouts"');
  });
});

// ---------------------------------------------------------------------------
// 2. Self-cancellation, and nothing wider
// ---------------------------------------------------------------------------

describe("the leave policy is the narrowest that works", () => {
  const policy = migration.slice(migration.indexOf('create policy "hangout requests self cancel"'));

  it("scopes updates to the caller's own row", () => {
    expect(policy).toContain("auth.uid() = requester_id");
  });

  it("pins the destination to cancelled, so nobody can self-accept", () => {
    // Without the WITH CHECK, a requester could set their own row to
    // 'accepted' and admit themselves to an UpFor the owner never approved.
    // That is the escalation this clause exists to prevent.
    expect(policy).toMatch(/with check[\s\S]*status = 'cancelled'/);
  });

  it("cannot resurrect a request the owner declined", () => {
    // USING restricts which rows the update can see at all.
    expect(policy).toMatch(/using[\s\S]*status in \('pending', 'accepted'\)/);
  });

  it("grants no broader mutation of request rows", () => {
    expect(migration).not.toMatch(/for all on public\.hangout_requests/);
    expect(migration).not.toMatch(/for delete[\s\S]{0,80}hangout_requests/);
  });

  it("adds no other policy or table", () => {
    // Participation already lives in hangout_requests; a second membership
    // table would be two sources of truth for one fact.
    expect(migration).not.toContain("create table");
    expect((migration.match(/create policy/g) ?? []).length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// 3. The action
// ---------------------------------------------------------------------------

describe("leaving is server-authoritative and idempotent", () => {
  it("cancels only the caller's own row", () => {
    expect(leaveAction).toContain('.eq("requester_id", userId)');
  });

  it("only transitions from pending or accepted", () => {
    expect(leaveAction).toContain('.in("status", ["pending", "accepted"])');
  });

  it("treats a repeat call as success rather than an error", () => {
    // A user who taps twice, or whose first response was lost, must not see a
    // failure for the state the product is already in.
    expect(leaveAction).toContain("const left = (updated ?? []).length > 0");
    expect(leaveAction).toContain("ok: true");
  });

  it("gives the same neutral answer whatever the reason", () => {
    // Distinguishing blocked from unfriended from expired would let anyone
    // probe why their access ended.
    expect(leaveAction).not.toContain("blocked");
    expect(leaveAction).not.toContain("no longer friends");
    expect(leaveAction).not.toContain("expired");
  });

  it("cannot be used by an owner to end their own UpFor", () => {
    // The owner has no request row, so nothing matches. Ending stays a
    // separate, ownership-level action.
    expect(actions).toContain("export async function endHangoutAction");
    expect(leaveAction).not.toContain("owner_id");
  });

  it("writes no denormalised counter", () => {
    // Capacity is derived from accepted rows, so the freed seat needs no
    // bookkeeping and nothing can drift.
    expect(leaveAction).not.toContain("going_count");
    expect(migration).not.toContain("create trigger");
  });
});

// ---------------------------------------------------------------------------
// 4. Capacity and the Joined filter
// ---------------------------------------------------------------------------

describe("leaving frees the seat immediately", () => {
  it("reopens capacity the moment the row is cancelled", () => {
    expect(hasSpace({ goingCount: 5, maxParticipants: 5 })).toBe(false);
    // One accepted row cancelled -> one seat back.
    expect(hasSpace({ goingCount: 4, maxParticipants: 5 })).toBe(true);
  });

  it("counts accepted rows only, so a cancelled row never occupies a seat", () => {
    expect(actions).toContain('.eq("status", "accepted")');
  });

  it("stops matching Joined once cancelled", () => {
    expect(isJoined({ myRequestStatus: "accepted" })).toBe(true);
    expect(isJoined({ myRequestStatus: "cancelled" })).toBe(false);
  });

  it("drops out of a Joined-filtered list after leaving", () => {
    const item = {
      activityType: "food" as const,
      areaTier: null,
      endsAt: new Date(Date.now() + 3_600_000).toISOString(),
      goingCount: 2,
      maxParticipants: 5,
      myRequestStatus: "accepted" as string | null
    };
    const joinedOnly = { toggles: new Set(["joined" as const]), activity: null };
    expect(applyUpForFilters([item], joinedOnly, Date.now())).toHaveLength(1);
    expect(
      applyUpForFilters([{ ...item, myRequestStatus: "cancelled" }], joinedOnly, Date.now())
    ).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 5. The card
// ---------------------------------------------------------------------------

describe("the card offers the right withdrawal", () => {
  /* The card moved to components/hangout/upfor-card.tsx. Both properties below
   * are unchanged and still matter -- they just live in the component that
   * draws the control rather than in the page that used to inline it. */
  const card = stripComments(read("components/hangout/upfor-card.tsx"));

  it("says Cancel request while pending and Leave once accepted", () => {
    expect(card).toContain('accepted ? "Leave" : "Cancel request"');
  });

  it("does not treat a cancelled row as an outstanding request", () => {
    /* Otherwise the card would sit on "Cancel request" forever and the join
     * control could never return. Only pending and accepted count as being
     * in; every other status -- cancelled included -- falls through to the
     * join controls. */
    /* Asserted as a CONTRACT rather than as a literal source line: the original
       check pinned the exact text `const joined = requested || accepted;`, so
       adding the legitimate historic "maybe" case broke it without anything
       being wrong. What must hold is which statuses count as being in. */
    expect(card).toContain('const requested = upfor.myRequestStatus === "pending";');
    expect(card).toContain('const accepted = upfor.myRequestStatus === "accepted";');
    // cancelled / null fall through to the join control ...
    expect(card).not.toMatch(/joined\s*=\s*[^;]*"cancelled"/);
    // ... and a declined answer gets its own outcome rather than re-offering.
    expect(card).toContain('const declined = upfor.myRequestStatus === "declined";');
  });

  it("reverts optimistically on failure rather than claiming success", () => {
    const handler = page.slice(page.indexOf("function leaveUpFor"));
    expect(handler.slice(0, 1600)).toContain("myRequestStatus: previous");
  });
});
