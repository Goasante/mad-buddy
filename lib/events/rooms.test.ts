import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join as joinPath } from "node:path";

import { resolveJoinEventCircle, type JoinCircleInput } from "@/lib/events/rules";
import { resolveNotificationDestination } from "@/lib/notifications/destination";

const ROOT = process.cwd();
const read = (path: string) => readFileSync(joinPath(ROOT, path), "utf8");

const MIGRATION = read("supabase/migrations/20260827120000_event_rooms_productization.sql");
const ACTIONS = read("app/(app)/event-actions.ts");
const ROOMS = read("lib/events/rooms.ts");
const SCAN = read("app/(app)/scan-actions.ts");

function join(overrides: Partial<JoinCircleInput> = {}): JoinCircleInput {
  return {
    status: "open",
    joinMode: "check_in",
    memberStatus: null,
    memberCount: 0,
    maxMembers: 100,
    hasEventCheckIn: true,
    hasValidToken: false,
    hasInvitation: false,
    hasGroupTargets: false,
    isEligibleGroupMember: false,
    opensAtMs: null,
    nowMs: Date.now(),
    ...overrides
  };
}

/**
 * THE TWO AUTHORIZATION HOLES.
 *
 * These are the reason this tranche has a migration at all. Both let the UI
 * promise a restriction the backend did not enforce, and both are the kind of
 * bug that looks fine in every screenshot.
 */
describe("Event Room join gates (the holes that were open)", () => {
  it("refuses a group-gated room to somebody in none of its groups", () => {
    // Before: `community` had no branch and fell through to allowed -- a Room
    // advertising "Group members" admitted the entire internet.
    expect(
      resolveJoinEventCircle(
        join({ joinMode: "community", hasGroupTargets: true, isEligibleGroupMember: false })
      )
    ).toEqual({ allowed: false, reason: "needs_group_membership" });
  });

  it("admits a current member of a targeted group", () => {
    expect(
      resolveJoinEventCircle(
        join({ joinMode: "community", hasGroupTargets: true, isEligibleGroupMember: true })
      ).allowed
    ).toBe(true);
  });

  it("admits nobody to a group-gated room with no groups selected", () => {
    // Absence of configuration is not permission.
    expect(
      resolveJoinEventCircle(
        join({ joinMode: "community", hasGroupTargets: false, isEligibleGroupMember: true })
      ).allowed
    ).toBe(false);
  });

  it("refuses an invite-only room to a token holder who was never invited", () => {
    // Before: any valid circle_join token satisfied `invite`, so a forwarded QR
    // defeated the entire point of the mode.
    expect(
      resolveJoinEventCircle(join({ joinMode: "invite", hasValidToken: true, hasInvitation: false }))
    ).toEqual({ allowed: false, reason: "needs_invitation" });
  });

  it("admits an invited person with no token at all", () => {
    expect(
      resolveJoinEventCircle(join({ joinMode: "invite", hasValidToken: false, hasInvitation: true }))
        .allowed
    ).toBe(true);
  });

  it("still requires a live check-in for a check-in room", () => {
    expect(resolveJoinEventCircle(join({ joinMode: "check_in", hasEventCheckIn: false })).reason).toBe(
      "needs_check_in"
    );
  });

  it("still requires a token for a QR room", () => {
    expect(resolveJoinEventCircle(join({ joinMode: "qr", hasValidToken: false })).reason).toBe(
      "needs_token"
    );
  });

  it("keeps a ban terminal against every mode", () => {
    for (const joinMode of ["invite", "check_in", "qr", "community"] as const) {
      expect(
        resolveJoinEventCircle(
          join({
            joinMode,
            memberStatus: "banned",
            hasInvitation: true,
            hasValidToken: true,
            hasGroupTargets: true,
            isEligibleGroupMember: true,
            hasEventCheckIn: true
          })
        ).reason
      ).toBe("banned");
    }
  });

  it("enforces capacity before any mode is considered", () => {
    expect(resolveJoinEventCircle(join({ memberCount: 100, maxMembers: 100 })).reason).toBe("full");
  });

  it("refuses a closed or archived room", () => {
    expect(resolveJoinEventCircle(join({ status: "archived" })).reason).toBe("closed");
    expect(resolveJoinEventCircle(join({ status: "closing" })).reason).toBe("closed");
  });
});

/**
 * The lifecycle authority. These assert the SHAPE of the migration rather than
 * running Postgres: what matters is that the transactional entry points exist,
 * that membership and conversation membership move together, and that nothing
 * hands these functions to a client.
 */
describe("Event Room lifecycle authority", () => {
  it("creates the room, its host membership and its conversation in one function", () => {
    expect(MIGRATION).toContain("create or replace function public.create_event_room");
    expect(MIGRATION).toContain("perform public.reconcile_event_room_conversation(v_room_id)");
  });

  it("reconciles conversation membership from room membership on every change", () => {
    for (const fn of [
      "join_event_room",
      "set_event_room_membership",
      "set_event_room_role",
      "archive_event_room"
    ]) {
      expect(MIGRATION).toContain(`create or replace function public.${fn}`);
    }
    // Each membership-changing function ends by reconciling, so Room membership
    // and conversation membership cannot drift apart.
    const reconcileCalls = MIGRATION.match(/public\.reconcile_event_room_conversation\(/g) ?? [];
    expect(reconcileCalls.length).toBeGreaterThanOrEqual(5);
  });

  it("takes the room row lock before counting capacity", () => {
    // Two simultaneous joins must not both see "one seat left".
    const joinFn = MIGRATION.slice(MIGRATION.indexOf("function public.join_event_room"));
    expect(joinFn).toContain("for update");
    expect(joinFn.indexOf("for update")).toBeLessThan(joinFn.indexOf("ROOM_FULL"));
  });

  it("treats an already-joined user as success rather than a duplicate insert", () => {
    const joinFn = MIGRATION.slice(MIGRATION.indexOf("function public.join_event_room"));
    expect(joinFn).toContain("on conflict (event_circle_id, user_id) do update");
    expect(joinFn).toContain("is distinct from 'joined'");
  });

  it("re-checks the ban inside the write path, not only in the caller", () => {
    const joinFn = MIGRATION.slice(MIGRATION.indexOf("function public.join_event_room"));
    expect(joinFn).toContain("ROOM_BANNED");
  });

  it("revokes a pending invitation when somebody is banned", () => {
    const fn = MIGRATION.slice(MIGRATION.indexOf("function public.set_event_room_membership"));
    expect(fn).toContain("status = 'revoked'");
  });

  it("archives a room read-only without deleting anything", () => {
    const fn = MIGRATION.slice(
      MIGRATION.indexOf("function public.archive_event_room"),
      MIGRATION.indexOf("function public.close_event_rooms_for_event")
    );
    expect(fn).toContain("status = 'archived'");
    // Read-only comes from the conversation status the existing canSendMessage
    // authority already refuses, not from a new parallel rule.
    expect(fn).toContain("update public.conversations");
    expect(fn).not.toMatch(/delete from public\.(messages|event_circle_members)/);
  });

  it("moves rooms to closing when an event ends, and never deletes them", () => {
    const fn = MIGRATION.slice(MIGRATION.indexOf("function public.close_event_rooms_for_event"));
    expect(fn).toContain("status = 'closing'");
    expect(fn).not.toContain("delete from");
  });

  it("guarantees exactly one conversation per room", () => {
    expect(MIGRATION).toContain("conversations_event_circle_unique");
    expect(MIGRATION).toContain("where context_type = 'event_circle'");
  });

  it("never grants the lifecycle functions to a client role", () => {
    for (const fn of [
      "reconcile_event_room_conversation",
      "create_event_room",
      "join_event_room",
      "set_event_room_membership",
      "set_event_room_role",
      "archive_event_room",
      "close_event_rooms_for_event"
    ]) {
      // Each is revoked from public/anon/authenticated and granted only to
      // service_role: a client calling join_event_room directly would bypass
      // every product rule in the action layer.
      expect(MIGRATION).toMatch(
        new RegExp(`revoke all on function public\\.${fn}\\([^)]*\\)\\s*\\n?\\s*from public, anon, authenticated`)
      );
      expect(MIGRATION).toMatch(new RegExp(`grant execute on function public\\.${fn}\\([^)]*\\)\\s*\\n?\\s*to service_role`));
    }
  });

  it("enables row level security on every new table", () => {
    for (const table of [
      "event_circle_invitations",
      "event_circle_group_targets",
      "event_announcement_reactions"
    ]) {
      expect(MIGRATION).toContain(`alter table public.${table} enable row level security`);
    }
  });

  it("does not let an invitee enumerate the rest of a room's invite list", () => {
    expect(MIGRATION).toContain('create policy "event circle invitations visible to invitee"');
    expect(MIGRATION).toContain("for select using (auth.uid() = invited_user_id)");
  });

  it("is additive: no production table is renamed or dropped", () => {
    expect(MIGRATION).not.toMatch(/drop table/i);
    expect(MIGRATION).not.toMatch(/alter table [^\n]*rename/i);
  });
});

/** The action layer must route writes through the RPCs, not hand-rolled steps. */
describe("Event Room actions use the lifecycle authority", () => {
  it("joins, leaves, creates and archives through RPCs", () => {
    expect(ACTIONS).toContain('admin.rpc("join_event_room"');
    expect(ACTIONS).toContain('admin.rpc("set_event_room_membership"');
    expect(ACTIONS).toContain('admin.rpc("create_event_room"');
    expect(ACTIONS).toContain('admin.rpc("archive_event_room"');
  });

  it("verifies a scanned token for purpose AND context before joining", () => {
    expect(ACTIONS).toContain('verified.payload.purpose === "circle_join"');
    expect(ACTIONS).toContain("verified.payload.contextId === circleId");
  });

  it("never lets a client's includeUnlisted flag be the authorization", () => {
    // The flag is a hint; isEventOperator decides.
    expect(ACTIONS).toContain("includeUnlisted && (await isEventOperator(admin, eventId, userId))");
  });

  it("caps a host-chosen member limit to their tier rather than trusting it", () => {
    expect(ACTIONS).toContain("Math.min(parsed.data.maxMembers");
    expect(ACTIONS).toContain("eventCircleMaxMembersFor");
  });

  it("only lets a host target groups they are actually in", () => {
    expect(ACTIONS).toContain("You can only choose groups you are in.");
    expect(MIGRATION).toContain("ROOM_GROUP_TARGET_FORBIDDEN");
  });

  it("requires event authority to mint a check-in QR", () => {
    const fn = ACTIONS.slice(ACTIONS.indexOf("export async function createEventCheckInQrAction"));
    expect(fn).toContain("isEventOperator");
    expect(fn).toContain('purpose: "check_in"');
  });

  it("requires room authority to mint a room QR", () => {
    const fn = ACTIONS.slice(ACTIONS.indexOf("export async function createRoomJoinQrAction"));
    expect(fn).toContain("canManageRoom");
    expect(fn).toContain('purpose: "circle_join"');
  });

  it("gives every minted token a short expiry", () => {
    expect(ACTIONS).toContain("const QR_TOKEN_TTL_MS = 5 * 60 * 1000");
  });

  it("restricts the guest list to whoever operates the event", () => {
    const fn = ACTIONS.slice(ACTIONS.indexOf("export async function listEventGuestsAction"));
    expect(fn).toContain("isEventOperator");
    // Operational identity only -- never contact details.
    expect(fn).not.toMatch(/\bemail\b|\bphone\b/);
  });

  it("lets only the host end an event", () => {
    const fn = ACTIONS.slice(ACTIONS.indexOf("export async function endEventAction"));
    expect(fn).toContain("event.host_id !== userId");
    expect(fn).toContain('admin.rpc("close_event_rooms_for_event"');
  });

  it("requires room membership to react to a notice", () => {
    const fn = ACTIONS.slice(ACTIONS.indexOf("export async function setRoomNoticeReactionAction"));
    expect(fn).toContain("access.isMember");
    // One row per person per notice: a double tap updates rather than adds.
    expect(fn).toContain('onConflict: "event_announcement_id,user_id"');
  });
});

/** Read models must not leak. */
describe("Event Room read models", () => {
  it("never selects private profile fields for a member list", () => {
    // Asserted against the actual .select() column lists rather than the whole
    // file: the doc comments legitimately mention email and phone in order to
    // state the guarantee, and matching prose would fail on the promise itself.
    const selects = ROOMS.match(/\.select\(\s*"([^"]+)"/g) ?? [];
    expect(selects.length).toBeGreaterThan(0);
    for (const select of selects) {
      expect(select).not.toMatch(/email|phone|latitude|longitude|address/i);
    }
  });

  it("hides an unlisted room from someone with no standing in it", () => {
    expect(ROOMS).toContain("if (!found.listedInEvent && !found.isMember && !found.canManage) return null;");
  });

  it("refuses to enumerate members to a non-member", () => {
    const fn = ROOMS.slice(ROOMS.indexOf("export async function listRoomMembers"));
    expect(fn).toContain("if (!access.exists || !access.isMember) return [];");
  });

  it("refuses to show notices to a non-member", () => {
    const fn = ROOMS.slice(ROOMS.indexOf("export async function listRoomNotices"));
    expect(fn).toContain("if (!access.exists || !access.isMember) return [];");
  });

  it("treats the event host as an operator even though they are not in event_admins", () => {
    // events.host_id is sole ownership; the host is deliberately absent from
    // event_admins, so asking only that table would lock a host out of their
    // own Event.
    const fn = ROOMS.slice(ROOMS.indexOf("export async function isEventOperator"));
    expect(fn).toContain("event?.host_id === userId");
    expect(fn).toContain("viewerIsEventAdmin");
  });
});

/** Cross-app routing. */
describe("Event Room notifications and deep links", () => {
  const EVENT_ID = "8b9e9e41-97c3-4e57-a3c2-d9333db3e134";
  const ROOM_ID = "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f";

  it("opens the room inside its event, never generic Events home", () => {
    expect(resolveNotificationDestination(`event_room:${EVENT_ID}:${ROOM_ID}`)).toEqual({
      type: "internal",
      href: `/events?event=${EVENT_ID}&room=${ROOM_ID}`
    });
  });

  it("falls back to the event when the room half is unusable", () => {
    expect(resolveNotificationDestination(`event_room:${EVENT_ID}:not-a-uuid`)).toEqual({
      type: "internal",
      href: `/events?event=${EVENT_ID}`
    });
  });

  it("never builds a destination from an injected value", () => {
    expect(resolveNotificationDestination("event_room:https://evil.example")).toEqual({
      type: "internal",
      href: "/events"
    });
  });

  it("hands the scanner enough context to open what it just joined", () => {
    expect(SCAN).toContain("roomId: result.circleId ?? payload.contextId");
    expect(SCAN).toContain("eventId: result.eventId");
  });

  it("keeps the scan result type out of the use-server module", () => {
    // A "use server" file may export only async functions; a type export there
    // becomes a runtime ReferenceError that tsc cannot see.
    expect(SCAN).not.toMatch(/^export type/m);
    expect(SCAN).toContain('import type { ScanResultState } from "@/lib/scan/types"');
  });
});
