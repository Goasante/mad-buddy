import { beforeAll, describe, expect, it } from "vitest";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  connectWithCandidate,
  passCandidate,
  undoLastLinkrAction
} from "@/lib/linkr/connection-service";
import { resolveMutualDestination } from "@/lib/linkr/mutual-resolution";
import { loadClickedPeople, loadPendingClicks } from "@/lib/linkr/collections-service";
import { loadLinkrGallery } from "@/lib/linkr/media-projection";
import { resolveNotificationDestination } from "@/lib/notifications/destination";
import { parseLiveSignal } from "@/lib/notifications/live-signal";

/**
 * THE LIVE LOCAL JOURNEY.
 *
 * Runs the real Linkr services against the LOCAL Supabase stack (127.0.0.1),
 * so the SECURITY DEFINER RPC, its advisory lock, the block guards, the
 * notification writes and the late-bound destination resolution all execute
 * for real rather than against a double.
 *
 * Skips itself entirely unless pointed at localhost, so it can never touch
 * production. Requires scripts/hardening/linkr-t2-fixtures.sql to have run.
 */

const A = "0a000000-0000-4000-8000-00000000000a";
const B = "0b000000-0000-4000-8000-00000000000b";
const C = "0c000000-0000-4000-8000-00000000000c";
const D = "0d000000-0000-4000-8000-00000000000d";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const isLocal = /127\.0\.0\.1|localhost/.test(url);

const admin = () => createSupabaseAdminClient();

async function linkrNotifications(userId: string) {
  const { data } = await admin()
    .from("notifications")
    .select("id, type, title, message")
    .eq("user_id", userId)
    .like("type", "linkr_connection%")
    .order("created_at", { ascending: false });
  return data ?? [];
}

async function connectionsOfA() {
  const { data } = await admin()
    .from("linkr_connections")
    .select("id, user_low, user_high, conversation_id, ended_at")
    .or(`user_low.eq.${A},user_high.eq.${A}`);
  return data ?? [];
}

describe.skipIf(!isLocal)("Linkr Tranche 2 -- live local journey", () => {
  let connectionId = "";
  let conversationId = "";

  /* THIS SUITE CONSUMES ITS OWN FIXTURE.
   *
   * The cases walk one pair through a decision journey -- pass, undo, connect,
   * reciprocate -- so by case 3 the "no decision yet" state the privacy
   * assertions rely on has already been spent. Re-running the file therefore
   * failed on a persistent database while passing on a fresh one, which reads
   * exactly like a product regression. The fixture SQL is idempotent and
   * deliberately resets the pair to a pre-decision state, so clearing this
   * suite's own rows here makes the file self-contained and order-independent.
   * Scoped strictly to the four fixture identities. */
  beforeAll(async () => {
    expect(isLocal, "must run against local Supabase").toBe(true);
    const db = admin();
    const fixtureIds = [A, B, C, D];
    await db.from("linkr_actions").delete().in("actor_id", fixtureIds);
    await db.from("linkr_actions").delete().in("target_id", fixtureIds);
    await db.from("linkr_connections").delete().in("user_low", fixtureIds);
    await db.from("linkr_connections").delete().in("user_high", fixtureIds);
    await db.from("notifications").delete().in("user_id", fixtureIds).like("type", "linkr_connection%");
    /* Case 12 asserts "before any message"; case 13 sends one. Without this the
       conversation and its message survive into the next run and 12 resolves to
       `conversation` instead of `mutual`. */
    const { data: convs } = await db
      .from("conversations")
      .select("id")
      .eq("conversation_type", "direct")
      .in("created_by", fixtureIds);
    const convIds = (convs ?? []).map((row: { id: string }) => row.id);
    if (convIds.length > 0) {
      await db.from("messages").delete().in("conversation_id", convIds);
      await db.from("conversations").delete().in("id", convIds);
    }
  });

  it("1. Pass then Undo restores the candidate", async () => {
    await passCandidate(A, C);
    const { data: after } = await admin()
      .from("linkr_actions")
      .select("action")
      .eq("actor_id", A)
      .eq("target_id", C)
      .maybeSingle();
    expect(after?.action).toBe("pass");

    const undo = await undoLastLinkrAction(A);
    expect(undo.ok).toBe(true);
    expect(undo.restoredUserId).toBe(C);

    const { data: gone } = await admin()
      .from("linkr_actions")
      .select("id")
      .eq("actor_id", A)
      .eq("target_id", C)
      .maybeSingle();
    expect(gone).toBeNull();
  });

  it("2. Pass writes the 30-day cooldown", async () => {
    await passCandidate(A, C);
    const { data } = await admin()
      .from("linkr_actions")
      .select("expires_at")
      .eq("actor_id", A)
      .eq("target_id", C)
      .maybeSingle();
    const days = Math.round((Date.parse(data!.expires_at!) - Date.now()) / 86_400_000);
    expect(days).toBe(30);
    await undoLastLinkrAction(A);
  });

  it("3. One-sided Connect is private to A", async () => {
    const result = await connectWithCandidate(A, B);
    expect(result.ok).toBe(true);
    expect(result.matched).toBe(false);
    expect(await connectionsOfA()).toHaveLength(0);
    // The whole invariant: B learns nothing at all.
    expect(await linkrNotifications(B)).toHaveLength(0);
  });

  it("4. Your clicks shows A's own choice, and shows B nothing", async () => {
    const aPending = await loadPendingClicks(A);
    const bPending = await loadPendingClicks(B);
    expect(aPending.map((p) => p.userId)).toContain(B);
    expect(bPending).toHaveLength(0);
  });

  it("5. Your clicks carries no field describing the other person's action", async () => {
    const [entry] = await loadPendingClicks(A);
    expect(Object.keys(entry!).sort()).toEqual(["clickedAt", "displayName", "photo", "userId"]);
  });

  it("6. Reciprocity creates exactly ONE connection", async () => {
    const result = await connectWithCandidate(B, A);
    expect(result.matched).toBe(true);
    const rows = await connectionsOfA();
    expect(rows).toHaveLength(1);
    connectionId = rows[0]!.id;
    conversationId = rows[0]!.conversation_id ?? "";
  });

  it("7. Both people get one mutual notification naming the other", async () => {
    const aNotifs = await linkrNotifications(A);
    const bNotifs = await linkrNotifications(B);
    expect(aNotifs).toHaveLength(1);
    expect(bNotifs).toHaveLength(1);
    expect(aNotifs[0]!.title).toContain("Kofi");
    expect(bNotifs[0]!.title).toContain("Ama");
    expect(`${aNotifs[0]!.title} ${aNotifs[0]!.message}`).not.toMatch(/match|soulmate|crush/i);
  });

  it("8. Mutual belongs to BOTH sides", async () => {
    expect((await loadClickedPeople(A)).map((p) => p.userId)).toContain(B);
    expect((await loadClickedPeople(B)).map((p) => p.userId)).toContain(A);
  });

  it("9. A mutual person graduates out of Your clicks", async () => {
    expect((await loadPendingClicks(A)).map((p) => p.userId)).not.toContain(B);
  });

  it("10. Repeat Connects create no duplicate connection or notification", async () => {
    await connectWithCandidate(A, B);
    await connectWithCandidate(B, A);
    expect(await connectionsOfA()).toHaveLength(1);
    expect(await linkrNotifications(A)).toHaveLength(1);
  });

  it("11. The notification routes to the pair and parses as a live signal", async () => {
    const [notif] = await linkrNotifications(A);
    expect(resolveNotificationDestination(notif!.type)?.href).toBe(
      `/linkr?connection=${connectionId}`
    );
    expect(parseLiveSignal(notif!.type)).toEqual({ kind: "linkr_mutual", connectionId });
  });

  it("12. Before any message it opens the mutual state", async () => {
    const resolved = await resolveMutualDestination(admin(), A, connectionId);
    expect(resolved.kind).toBe("mutual");
  });

  it("13. Once somebody speaks, the OLD notification opens that exact chat", async () => {
    expect(conversationId).toBeTruthy();
    await admin().from("messages").insert({
      conversation_id: conversationId,
      sender_id: B,
      message_type: "text",
      text_content: "Hey"
    });

    const a = await resolveMutualDestination(admin(), A, connectionId);
    const b = await resolveMutualDestination(admin(), B, connectionId);
    expect(a.kind).toBe("conversation");
    expect(b.kind).toBe("conversation");
    if (a.kind === "conversation" && b.kind === "conversation") {
      expect(a.conversationId).toBe(conversationId);
      expect(a.conversationId).toBe(b.conversationId);
    }
  });

  it("14. Clicked switches Say hi -> Continue chat", async () => {
    const entry = (await loadClickedPeople(A)).find((p) => p.userId === B);
    expect(entry?.hasConversation).toBe(true);
  });

  it("15. URL possession grants nothing", async () => {
    const outsider = await resolveMutualDestination(admin(), D, connectionId);
    const bogus = await resolveMutualDestination(
      admin(),
      A,
      "00000000-0000-4000-8000-000000000000"
    );
    expect(outsider.kind).toBe("unavailable");
    expect(bogus.kind).toBe("unavailable");
  });

  it("16. A block placed AFTER the notification fails it closed", async () => {
    await admin().from("blocked_users").insert({ blocker_id: A, blocked_id: B });
    try {
      const resolved = await resolveMutualDestination(admin(), A, connectionId);
      expect(resolved.kind).toBe("unavailable");
      expect((await loadClickedPeople(A)).map((p) => p.userId)).not.toContain(B);
    } finally {
      await admin().from("blocked_users").delete().eq("blocker_id", A).eq("blocked_id", B);
    }
  });

  it("17. Linkr card media admits only 'everyone' photos", async () => {
    const { data: asset } = await admin()
      .from("media_assets")
      .select("id")
      .limit(1)
      .maybeSingle();
    if (!asset) return;

    await admin().from("profile_photos").delete().eq("user_id", C);
    await admin()
      .from("profile_photos")
      .insert([
        { user_id: C, media_asset_id: asset.id, position: 0, visibility: "everyone" },
        { user_id: C, media_asset_id: asset.id, position: 1, visibility: "approved_muddies" },
        { user_id: C, media_asset_id: asset.id, position: 2, visibility: "only_me" }
      ]);
    try {
      // Avatar plus the single public showcase. The Muddies-only and private
      // photos must never reach a stranger's card.
      expect((await loadLinkrGallery(admin(), C)).length).toBeLessThanOrEqual(2);
    } finally {
      await admin().from("profile_photos").delete().eq("user_id", C);
    }
  });
});
