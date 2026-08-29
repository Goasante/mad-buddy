import { beforeAll, describe, expect, it } from "vitest";

import { actAs, installActingUser, USERS, EVENT_ID } from "@/lib/test/acting-user";

/**
 * EVENT ROOM SHARED HISTORY — the production bug and its guards.
 *
 * A sent a message, B joined later, B could not see it. The cause was in
 * reconcile_event_room_conversation: it stored a joining member's
 * history_visible_from as their joined_at, and both the message loader and the
 * RLS policy on public.messages filter `created_at >= history_visible_from`.
 *
 * These tests prove the product rule in BOTH directions, because the fix widens
 * a readable window and a careless widening is a data leak:
 *
 *   admitted to the Room  -> reads the Room's history, including what predates
 *                            the join
 *   not admitted          -> reads nothing
 *   removed / banned      -> loses the conversation and its history
 *
 * Runs against the real local Postgres so the RPC, the reconciliation and the
 * membership transitions all execute for real. Skips unless pointed at
 * localhost, so it can never touch production.
 */

installActingUser();

try {
  const fs = await import("node:fs");
  const raw = fs.readFileSync(".env.local", "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
  }
} catch {
  // No .env.local: the isLocal guard below skips the suite.
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const isLocal = /127\.0\.0\.1|localhost/.test(url);
const describeLocal = isLocal ? describe : describe.skip;
const DB_TIMEOUT = 30_000;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let admin: any;
let messaging: typeof import("@/lib/messaging/mobile");

/** A room built through the real product path, with a real prior message. */
async function seedRoomWithHistory(name: string) {
  const { data: roomId } = await admin.rpc("create_event_room", {
    p_owner_id: USERS.A,
    p_event_id: EVENT_ID,
    p_name: name,
    p_description: "history regression",
    p_join_mode: "check_in",
    p_max_members: 50,
    p_listed: true,
    p_group_conversation_ids: []
  });
  const room = String(roomId);

  const { data: conversation } = await admin
    .from("conversations")
    .select("id")
    .eq("context_type", "event_circle")
    .eq("context_id", room)
    .maybeSingle();
  const conversationId = String(conversation?.id);

  // M1 is stamped in the past: the real-world shape is a message that already
  // existed before the late joiner ever arrived.
  const { data: m1 } = await admin
    .from("messages")
    .insert({
      conversation_id: conversationId,
      sender_id: USERS.A,
      message_type: "text",
      text_content: "M1 sent before the late joiner arrived",
      client_message_id: `hist-${Math.random().toString(36).slice(2, 12)}`,
      created_at: new Date(Date.now() - 60 * 60 * 1000).toISOString()
    })
    .select("id")
    .single();

  return { room, conversationId, m1: String(m1?.id) };
}

beforeAll(async () => {
  if (!isLocal) return;
  admin = (await import("@/lib/supabase/admin")).createSupabaseAdminClient();
  messaging = await import("@/lib/messaging/mobile");
});

describeLocal("Event Room shared history", () => {
  it("lets a late joiner read messages sent before they joined", async () => {
    const { room, conversationId, m1 } = await seedRoomWithHistory(`Late ${Math.random().toString(36).slice(2, 7)}`);

    // B is not a member yet: the Room's history must be closed to them.
    actAs(USERS.B);
    const beforeJoin = await messaging.listMessages(USERS.B, conversationId);
    expect(beforeJoin, "a non-member could read Room history").toEqual([]);

    // B joins through the canonical lifecycle RPC.
    await admin.rpc("join_event_room", { p_room_id: room, p_user_id: USERS.B });

    const afterJoin = await messaging.listMessages(USERS.B, conversationId);
    expect(
      afterJoin.some((message) => message.id === m1),
      "the late joiner still cannot see the message that predates their join"
    ).toBe(true);
  }, DB_TIMEOUT);

  it("does not create a second conversation for the late joiner", async () => {
    const { room, conversationId } = await seedRoomWithHistory(`One ${Math.random().toString(36).slice(2, 7)}`);
    await admin.rpc("join_event_room", { p_room_id: room, p_user_id: USERS.B });

    const { data: conversations } = await admin
      .from("conversations")
      .select("id")
      .eq("context_type", "event_circle")
      .eq("context_id", room);
    expect(conversations?.length, "the room grew a second conversation").toBe(1);
    expect(String(conversations?.[0]?.id)).toBe(conversationId);
  }, DB_TIMEOUT);

  it("lets both members see each other's messages after the late join", async () => {
    const { room, conversationId, m1 } = await seedRoomWithHistory(`Both ${Math.random().toString(36).slice(2, 7)}`);
    await admin.rpc("join_event_room", { p_room_id: room, p_user_id: USERS.B });

    const { data: m2 } = await admin
      .from("messages")
      .insert({
        conversation_id: conversationId,
        sender_id: USERS.B,
        message_type: "text",
        text_content: "M2 from the late joiner",
        client_message_id: `hist2-${Math.random().toString(36).slice(2, 12)}`
      })
      .select("id")
      .single();

    const hostView = await messaging.listMessages(USERS.A, conversationId);
    const lateView = await messaging.listMessages(USERS.B, conversationId);
    const ids = (list: Array<{ id: string }>) => list.map((entry) => entry.id);

    expect(ids(hostView)).toContain(String(m2?.id));
    expect(ids(lateView)).toContain(m1);
    expect(ids(lateView)).toContain(String(m2?.id));
  }, DB_TIMEOUT);

  /* THE OTHER DIRECTION. Widening a readable window is only safe if the
     membership gate still closes. */
  it("never exposes Room history to an unrelated user", async () => {
    const { conversationId } = await seedRoomWithHistory(`Outsider ${Math.random().toString(36).slice(2, 7)}`);
    actAs(USERS.C);
    expect(await messaging.listMessages(USERS.C, conversationId)).toEqual([]);
  }, DB_TIMEOUT);

  it("takes history away again when a member is removed", async () => {
    const { room, conversationId } = await seedRoomWithHistory(`Removed ${Math.random().toString(36).slice(2, 7)}`);
    await admin.rpc("join_event_room", { p_room_id: room, p_user_id: USERS.B });
    expect((await messaging.listMessages(USERS.B, conversationId)).length).toBeGreaterThan(0);

    await admin.rpc("set_event_room_membership", {
      p_room_id: room,
      p_user_id: USERS.B,
      p_status: "removed"
    });
    expect(
      await messaging.listMessages(USERS.B, conversationId),
      "a removed member kept access to Room history"
    ).toEqual([]);
  }, DB_TIMEOUT);

  it("takes history away again when a member is banned", async () => {
    const { room, conversationId } = await seedRoomWithHistory(`Banned ${Math.random().toString(36).slice(2, 7)}`);
    await admin.rpc("join_event_room", { p_room_id: room, p_user_id: USERS.B });
    expect((await messaging.listMessages(USERS.B, conversationId)).length).toBeGreaterThan(0);

    await admin.rpc("set_event_room_membership", {
      p_room_id: room,
      p_user_id: USERS.B,
      p_status: "banned"
    });
    expect(
      await messaging.listMessages(USERS.B, conversationId),
      "a banned member kept access to Room history"
    ).toEqual([]);
  }, DB_TIMEOUT);

  /* Reconcile runs on every membership and role change. It must never narrow a
     window a member could already read -- otherwise promoting someone would
     silently delete their history. */
  it("never narrows an existing member's readable window on later reconciles", async () => {
    const { room, conversationId, m1 } = await seedRoomWithHistory(`Reconcile ${Math.random().toString(36).slice(2, 7)}`);
    await admin.rpc("join_event_room", { p_room_id: room, p_user_id: USERS.B });

    // A role change re-runs the reconciler for everyone in the room.
    await admin.rpc("set_event_room_role", {
      p_room_id: room,
      p_user_id: USERS.B,
      p_role: "moderator"
    });

    const view = await messaging.listMessages(USERS.B, conversationId);
    expect(view.map((entry) => entry.id)).toContain(m1);
  }, DB_TIMEOUT);
}, DB_TIMEOUT);
