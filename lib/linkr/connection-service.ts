import "server-only";

import { LINKR_COPY } from "@/lib/linkr/rules";
import { isBlockedEitherDirection } from "@/lib/social/permissions";
import { consumeRateLimit, rateLimitMessage } from "@/lib/security/rate-limit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSupabaseServerEnv } from "@/lib/supabase/env";
import { directConversationKey } from "@/lib/messaging/rules";

/**
 * Pass, Connect, Undo, and the mutual connection they can produce.
 *
 * THE PRIVACY RULE THIS FILE EXISTS TO ENFORCE: a one-sided Connect is never
 * revealed. Not as a notification, not as a badge, not as a count, not as a
 * "someone likes you" nudge, and not by omission patterns a determined
 * observer could read. `connect()` returns `matched: false` and NOTHING is
 * written that the recipient can observe.
 *
 * Reciprocity is resolved by `linkr_record_connect`, a SECURITY DEFINER
 * function which is the only thing permitted to read both sides of
 * linkr_actions. This module never queries the other person's actions itself,
 * so there is no code path here that could leak the answer even by timing.
 */

type Admin = ReturnType<typeof createSupabaseAdminClient>;

/** How long an ordinary pass suppresses somebody. A hide writes no expiry. */
export const PASS_DURATION_MS = 30 * 24 * 60 * 60 * 1000;

/** Undo reaches back only this far, and only to the most recent action. */
export const UNDO_WINDOW_MS = 5 * 60 * 1000;

export type ConnectResult = {
  ok: boolean;
  message: string;
  /** True only when BOTH people chose each other. */
  matched: boolean;
  connectionId?: string;
  conversationId?: string;
  /** Filled only on a match, for the match screen. */
  matchedWith?: { userId: string; displayName: string; photo: string | null };
};

function serverReady(): boolean {
  const env = getSupabaseServerEnv();
  return Boolean(env.url && env.serviceRoleKey);
}

/**
 * Pass: a private decision, invisible to its subject.
 *
 * Upserted so a repeat is idempotent, and given an expiry so a thin pool
 * recovers on its own. `permanent` is what "Don't show me again" writes -- a
 * separate, lighter thing than Block, because not being interested in
 * somebody is not an accusation about them.
 */
export async function passCandidate(
  viewerId: string,
  targetId: string,
  options: { permanent?: boolean; eventId?: string | null } = {}
): Promise<{ ok: boolean; message: string }> {
  if (!serverReady()) return { ok: false, message: "This action needs the server database configuration." };
  if (viewerId === targetId) return { ok: false, message: "Not available." };

  const limit = await consumeRateLimit({ action: "linkr.decide", userId: viewerId });
  if (!limit.allowed) return { ok: false, message: rateLimitMessage(limit.resetAt) };

  const { error } = await createSupabaseAdminClient()
    .from("linkr_actions")
    .upsert(
      {
        actor_id: viewerId,
        target_id: targetId,
        action: "pass",
        event_id: options.eventId ?? null,
        expires_at: options.permanent ? null : new Date(Date.now() + PASS_DURATION_MS).toISOString(),
        updated_at: new Date().toISOString()
      },
      { onConflict: "actor_id,target_id" }
    );
  if (error) return { ok: false, message: "Couldn't do that. Try again." };
  return { ok: true, message: "" };
}

/**
 * Connect: private interest, which becomes a connection only if returned.
 *
 * The block check is re-run HERE rather than trusted from the deck the client
 * is holding: a block placed between load and tap must win, and the deck is by
 * definition a snapshot of the past.
 */
export async function connectWithCandidate(
  viewerId: string,
  targetId: string,
  options: { eventId?: string | null } = {}
): Promise<ConnectResult> {
  if (!serverReady()) {
    return { ok: false, matched: false, message: "This action needs the server database configuration." };
  }
  if (viewerId === targetId) return { ok: false, matched: false, message: "Not available." };

  const limit = await consumeRateLimit({ action: "linkr.decide", userId: viewerId });
  if (!limit.allowed) return { ok: false, matched: false, message: rateLimitMessage(limit.resetAt) };

  const admin = createSupabaseAdminClient();

  // Blocks win, and they win before anything is written.
  if (await isBlockedEitherDirection(admin, viewerId, targetId)) {
    // Deliberately indistinguishable from an ordinary success. Telling the
    // caller "you are blocked" would turn Connect into a block detector.
    return { ok: true, matched: false, message: "" };
  }

  const { data, error } = await admin.rpc("linkr_record_connect", {
    p_actor: viewerId,
    p_target: targetId,
    p_event_id: options.eventId ?? null
  });
  if (error) return { ok: false, matched: false, message: "Couldn't do that. Try again." };

  // The function returns a single row; PostgREST hands it back as an array.
  const result = Array.isArray(data) ? data[0] : data;
  if (!result?.matched) {
    // One-sided. Nothing more happens -- no conversation, no notification, no
    // trace the other person could ever observe.
    return { ok: true, matched: false, message: "" };
  }

  const connectionId = result.connection_id as string | undefined;

  /**
   * `created` is the idempotency token, and it comes from the database rather
   * than from a second query here. Exactly one caller can insert the
   * connection row, so exactly one caller sees `created = true` -- which makes
   * it the right thing to gate a once-only side effect on. Two simultaneous
   * connects both learn `matched = true` and both reach the match screen, but
   * only one of them notifies.
   */
  const isFirstResolution = Boolean(result.created);

  const conversationId = connectionId
    ? await ensureConnectionConversation(admin, connectionId, viewerId, targetId, options.eventId ?? null)
    : undefined;

  const { data: profile } = await admin
    .from("profiles")
    .select("full_name, username")
    .eq("user_id", targetId)
    .maybeSingle();
  /**
   * The matched person's face, from canonical Profile media.
   *
   * Index 0 of the projection is their profile picture, which is what the
   * match screen should show -- not whichever photo Linkr happened to store.
   */
  const { loadLinkrGallery } = await import("@/lib/linkr/media-projection");
  const photoUrl = (await loadLinkrGallery(admin, targetId))[0] ?? null;

  if (connectionId && isFirstResolution) {
    await notifyMutualConnection(admin, connectionId, viewerId, targetId);
  }

  return {
    ok: true,
    matched: true,
    message: LINKR_COPY.matchTitle,
    connectionId,
    conversationId,
    matchedWith: {
      userId: targetId,
      displayName: profile?.full_name?.trim() || profile?.username || "Someone",
      photo: photoUrl
    }
  };
}

/**
 * Creates (or finds) the conversation for a mutual connection.
 *
 * DOES NOT go through `getOrCreateDirectConversation`. That helper requires
 * the pair to be approved Muddies, which is the correct rule for ordinary
 * direct messages and the wrong one here: a Linkr connection is precisely a
 * pair who chose each other WITHOUT being Muddies. Routing through it would
 * either fail every time or force Linkr to fabricate a friendship, and
 * fabricating a friendship is the one thing this product must not do.
 *
 * So the conversation is created directly, with the same canonical shape
 * (`direct_key`, both members joined) that every other direct conversation
 * has. Messaging reads it identically; nothing downstream knows the
 * difference, and no second chat engine exists.
 */
async function ensureConnectionConversation(
  admin: Admin,
  connectionId: string,
  viewerId: string,
  targetId: string,
  eventId: string | null
): Promise<string | undefined> {
  const { data: connection } = await admin
    .from("linkr_connections")
    .select("conversation_id")
    .eq("id", connectionId)
    .maybeSingle();
  if (connection?.conversation_id) return connection.conversation_id;

  const key = directConversationKey(viewerId, targetId);

  // The pair may already have a conversation from some other context; reuse it
  // rather than creating a second thread between the same two people.
  const { data: existing } = await admin
    .from("conversations")
    .select("id")
    .eq("direct_key", key)
    .eq("conversation_type", "direct")
    .maybeSingle();

  let conversationId = existing?.id;
  if (!conversationId) {
    const { data: created } = await admin
      .from("conversations")
      .insert({
        conversation_type: "direct",
        created_by: viewerId,
        direct_key: key,
        // 'event' when the connection happened at one, so the thread can show
        // "Connected at ...". Otherwise null: Linkr does not need a context
        // type of its own, and adding one would touch the shared enum that
        // Events is also editing.
        context_type: eventId ? ("event" as const) : null,
        context_id: eventId,
        status: "active" as const
      })
      .select("id")
      .maybeSingle();

    if (created?.id) {
      conversationId = created.id;
      await admin.from("conversation_members").insert([
        { conversation_id: created.id, user_id: viewerId, role: "member" as const, status: "joined" as const },
        { conversation_id: created.id, user_id: targetId, role: "member" as const, status: "joined" as const }
      ]);
    } else {
      // Lost the unique-key race: the other side's connect created it first.
      const { data: raced } = await admin
        .from("conversations")
        .select("id")
        .eq("direct_key", key)
        .eq("conversation_type", "direct")
        .maybeSingle();
      conversationId = raced?.id;
    }
  }

  if (conversationId) {
    await admin
      .from("linkr_connections")
      .update({ conversation_id: conversationId, updated_at: new Date().toISOString() })
      .eq("id", connectionId)
      .is("conversation_id", null);
  }
  return conversationId;
}

/**
 * Notifies BOTH people that a mutual connection exists.
 *
 * Both, symmetrically, and only on a match. Neither message says who chose
 * first -- that is the fact the one-sided privacy rule protects, and it stays
 * protected after the match, not just before it.
 *
 * Called ONLY by the caller that inserted the connection row (`created` from
 * linkr_record_connect), so a retried or raced connect notifies exactly once
 * without needing a second claim query here.
 */
async function notifyMutualConnection(
  admin: Admin,
  connectionId: string,
  userA: string,
  userB: string
): Promise<void> {
  try {
    const rows = [userA, userB].map((userId) => ({
      user_id: userId,
      type: "linkr_connection",
      title: LINKR_COPY.matchTitle,
      // Symmetric wording. Neither person's copy names who acted first.
      message: "You both want to connect."
    }));
    await admin.from("notifications").insert(rows);
  } catch {
    // A missing notification must never fail the connection itself. The match
    // exists in the database either way, and both users see it on next load.
  }
}

/**
 * Undo the most recent decision, within a short window.
 *
 * DELIBERATELY REFUSES once a connection exists. Undo is for "I tapped the
 * wrong side of the card", not for silently deleting a relationship the other
 * person has already been told about and may have opened a conversation in.
 * Ending a connection is an explicit, separate act.
 */
export async function undoLastLinkrAction(
  viewerId: string
): Promise<{ ok: boolean; message: string; restoredUserId?: string }> {
  if (!serverReady()) return { ok: false, message: "This action needs the server database configuration." };
  const admin = createSupabaseAdminClient();

  const { data: last } = await admin
    .from("linkr_actions")
    .select("id, target_id, action, created_at")
    .eq("actor_id", viewerId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!last) return { ok: false, message: "Nothing to undo." };
  if (Date.now() - Date.parse(last.created_at) > UNDO_WINDOW_MS) {
    return { ok: false, message: "That's too long ago to undo." };
  }

  const low = viewerId < last.target_id ? viewerId : last.target_id;
  const high = viewerId < last.target_id ? last.target_id : viewerId;
  const { data: connection } = await admin
    .from("linkr_connections")
    .select("id")
    .eq("user_low", low)
    .eq("user_high", high)
    .is("ended_at", null)
    .maybeSingle();
  if (connection) {
    return { ok: false, message: "You're already connected. Open the chat to manage it." };
  }

  const { error } = await admin.from("linkr_actions").delete().eq("id", last.id).eq("actor_id", viewerId);
  if (error) return { ok: false, message: "Couldn't undo that. Try again." };
  return { ok: true, message: "Undone.", restoredUserId: last.target_id };
}

/** Ends a mutual connection. Explicit, and separate from Block. */
export async function endLinkrConnection(
  viewerId: string,
  otherUserId: string
): Promise<{ ok: boolean; message: string }> {
  if (!serverReady()) return { ok: false, message: "This action needs the server database configuration." };
  const low = viewerId < otherUserId ? viewerId : otherUserId;
  const high = viewerId < otherUserId ? otherUserId : viewerId;

  const { error } = await createSupabaseAdminClient()
    .from("linkr_connections")
    .update({ ended_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("user_low", low)
    .eq("user_high", high)
    .is("ended_at", null);
  if (error) return { ok: false, message: "Couldn't do that. Try again." };
  return { ok: true, message: "Disconnected." };
}

/**
 * The connection between two people, if any, for conversation context.
 *
 * Returns the Event name when there is one, so a thread can say "Connected at
 * AfroFuture Night" rather than the generic line.
 */
export async function loadConnectionContext(
  viewerId: string,
  otherUserId: string
): Promise<{ connected: boolean; contextLabel: string | null }> {
  if (!serverReady()) return { connected: false, contextLabel: null };
  const admin = createSupabaseAdminClient();
  const low = viewerId < otherUserId ? viewerId : otherUserId;
  const high = viewerId < otherUserId ? otherUserId : viewerId;

  const { data } = await admin
    .from("linkr_connections")
    .select("event_id")
    .eq("user_low", low)
    .eq("user_high", high)
    .is("ended_at", null)
    .maybeSingle();
  if (!data) return { connected: false, contextLabel: null };

  if (!data.event_id) return { connected: true, contextLabel: LINKR_COPY.connectedThroughLinkr };
  const { data: event } = await admin
    .from("events")
    .select("name")
    .eq("id", data.event_id)
    .maybeSingle();
  return {
    connected: true,
    contextLabel: event?.name
      ? LINKR_COPY.connectedAtEvent(event.name)
      : LINKR_COPY.connectedThroughLinkr
  };
}
