import "server-only";

import { LINKR_COPY } from "@/lib/linkr/rules";
import { isBlockedEitherDirection } from "@/lib/social/permissions";
import { consumeRateLimit, rateLimitMessage } from "@/lib/security/rate-limit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSupabaseServerEnv } from "@/lib/supabase/env";
import { getOrCreateDirectConversation } from "@/lib/messaging/service";
import { guardAction } from "@/lib/admin/enforcement";
import { resolveAge } from "@/lib/linkr/profile-service";
import { hasProfilePicture } from "@/lib/linkr/media-projection";

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

  const admin = createSupabaseAdminClient();
  const guard = await guardAction(admin, { userId: viewerId, surface: "linkr" });
  if (!guard.allowed) return { ok: false, message: guard.message };
  const { error } = await admin
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
  const guard = await guardAction(admin, { userId: viewerId, surface: "linkr" });
  if (!guard.allowed) return { ok: false, matched: false, message: guard.message };

  // Blocks win, and they win before anything is written.
  if (await isBlockedEitherDirection(admin, viewerId, targetId)) {
    // Deliberately indistinguishable from an ordinary success. Telling the
    // caller "you are blocked" would turn Connect into a block detector.
    return { ok: true, matched: false, message: "" };
  }

  // The card is a snapshot. Re-check non-negotiable eligibility immediately
  // before recording interest so a disabled, hidden, deleted, underage, or
  // photo-less account cannot be connected from a stale deck.
  const [{ data: targetLinkr }, { data: targetProfile }, targetAge, targetHasPhoto, targetGuard] =
    await Promise.all([
      admin.from("linkr_profiles").select("enabled").eq("user_id", targetId).maybeSingle(),
      admin.from("profiles").select("visibility_status, deleted_at").eq("user_id", targetId).maybeSingle(),
      resolveAge(admin, targetId),
      hasProfilePicture(admin, targetId),
      guardAction(admin, { userId: targetId, surface: "linkr" })
    ]);
  if (
    !targetLinkr?.enabled ||
    !targetProfile ||
    targetProfile.visibility_status === "ghost" ||
    Boolean(targetProfile.deleted_at) ||
    targetAge === null ||
    targetAge < 18 ||
    !targetHasPhoto ||
    !targetGuard.allowed
  ) {
    // Indistinguishable from a normal private Connect. Eligibility changes
    // must not become an account-status oracle.
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
 * DELEGATES to `getOrCreateDirectConversation` (MB-GOD-053). This function used
 * to build the conversation itself -- look up the direct_key, insert the row,
 * seed both members, handle the unique-key race -- which made Mad Buddy hold
 * TWO implementations of one job. Nothing unsafe came of it, but a future
 * change to how direct conversations are created (a new membership column, a
 * different race strategy, an added guard) had to be made in two places and
 * would silently drift if it were made in one.
 *
 * The comment that used to sit here said the canonical helper "requires the
 * pair to be approved Muddies". THAT WAS STALE. `resolveDirectMessageEligibility`
 * treats an active Linkr connection as an explicit early-allow
 * (`messaging/rules.ts:114`), and `canCreateDirectConversation` feeds it via
 * `hasActiveLinkrConnection`. The connection row is written before this runs,
 * so the pair is eligible by the canonical rule -- no friendship is fabricated,
 * which remains the thing this product must never do.
 *
 * THE OWNERSHIP BOUNDARY IS THE POINT, and it is now explicit:
 *   Linkr owns     the mutual-connection decision and its own record.
 *   Messaging owns creating and reusing a direct conversation.
 * Linkr-specific reciprocity logic stays here; it was not pushed into
 * messaging, and messaging was not broadened to accommodate Linkr.
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

  /* `event` context when the connection happened at one, so the thread can
     show "Connected at ...". Otherwise no context: Linkr does not need a
     context type of its own, and adding one would touch the shared enum that
     Events also edits. */
  const { conversationId } = await getOrCreateDirectConversation(
    admin,
    viewerId,
    targetId,
    eventId ? { contextType: "event", contextId: eventId } : undefined
  );

  if (conversationId) {
    await admin
      .from("linkr_connections")
      .update({ conversation_id: conversationId, updated_at: new Date().toISOString() })
      .eq("id", connectionId)
      .is("conversation_id", null);
  }
  return conversationId ?? undefined;
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
/** First name only: the notification is a nudge, not a dossier. */
function firstName(fullName: string | null | undefined): string {
  const trimmed = (fullName ?? "").trim();
  if (!trimmed) return "someone";
  return trimmed.split(/\s+/)[0] ?? "someone";
}

/** Canonical display names for a small set of users, in one query. */
async function displayNamesFor(
  admin: Admin,
  userIds: string[]
): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  const { data } = await admin
    .from("profiles")
    .select("user_id, full_name, username")
    .in("user_id", userIds);
  for (const row of data ?? []) {
    names.set(row.user_id, row.full_name?.trim() || row.username || "Someone");
  }
  return names;
}

async function notifyMutualConnection(
  admin: Admin,
  connectionId: string,
  userA: string,
  userB: string
): Promise<void> {
  try {
    /**
     * Each person is told WHO they clicked with. Both rows carry the
     * connection id in the `type`, using the product's existing
     * "<base>:<id>" convention, so tapping either one resolves the pair's
     * current state rather than landing on a generic Linkr page.
     *
     * The id is the ONLY thing stored. Where it leads -- the mutual screen or
     * an already-running conversation -- is decided at tap time by
     * resolveMutualDestination, which also re-checks blocks.
     */
    const names = await displayNamesFor(admin, [userA, userB]);
    const rows = [
      { userId: userA, otherId: userB },
      { userId: userB, otherId: userA }
    ].map(({ userId, otherId }) => ({
      user_id: userId,
      type: `linkr_connection:${connectionId}`,
      // Symmetric wording. Neither person's copy says who acted first -- the
      // one-sided privacy rule survives the match, it does not expire with it.
      title: LINKR_COPY.mutualNotificationTitle(firstName(names.get(otherId))),
      message: LINKR_COPY.mutualNotificationBody
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
  const guard = await guardAction(admin, { userId: viewerId, surface: "linkr" });
  if (!guard.allowed) return { ok: false, message: guard.message };

  /**
   * ORDER BY updated_at, NOT created_at.
   *
   * Decisions are UPSERTED on (actor_id, target_id), so re-deciding somebody
   * whose pass has lapsed updates a row that was created weeks ago. Ordering
   * by creation would then call some other, genuinely older decision "your
   * last one" and undo that instead -- silently restoring the wrong person and
   * leaving the one just passed still suppressed. `updated_at` is the only
   * column that tracks when the decision was actually made.
   */
  const { data: last } = await admin
    .from("linkr_actions")
    .select("id, target_id, action, created_at, updated_at")
    .eq("actor_id", viewerId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!last) return { ok: false, message: "Nothing to undo." };
  if (Date.now() - Date.parse(last.updated_at ?? last.created_at) > UNDO_WINDOW_MS) {
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
  const admin = createSupabaseAdminClient();
  const low = viewerId < otherUserId ? viewerId : otherUserId;
  const high = viewerId < otherUserId ? otherUserId : viewerId;

  const { error } = await admin
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
