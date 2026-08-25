import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isBlockedEitherDirection } from "@/lib/social/permissions";

/**
 * What a mutual-connection notification should open, decided AT TAP TIME.
 *
 * A notification is a record that something happened, not a promise about
 * where it leads. Between "you and Ama clicked" being written and being
 * tapped, the pair may have started talking, or one of them may have blocked
 * the other. Freezing a destination into the row would mean a stale "Say hi"
 * screen for a conversation already three messages deep, and -- far worse --
 * a tappable route into somebody who has since been blocked.
 *
 * So the row stores only the connection id, and this module answers the
 * question fresh every time it is asked.
 */

type Admin = ReturnType<typeof createSupabaseAdminClient>;

export type MutualResolution =
  /** Open the mutual "You clicked" state; no conversation exists yet. */
  | { kind: "mutual"; connectionId: string; otherUserId: string; conversationId: string | null }
  /** A conversation is already under way: go straight to it. */
  | { kind: "conversation"; conversationId: string; otherUserId: string }
  /**
   * FAIL CLOSED. A block, an ended connection, a connection that never
   * belonged to this viewer, or a row that no longer exists. The caller shows
   * Linkr, never an error naming the other person.
   */
  | { kind: "unavailable" };

/**
 * Does this conversation have real activity, or is it just an empty room?
 *
 * The distinction decides between "Say hi" and "Continue chat". An empty
 * conversation is created eagerly when the connection forms, so its mere
 * existence proves nothing about whether anybody has spoken.
 */
export async function conversationHasActivity(
  admin: Admin,
  conversationId: string
): Promise<boolean> {
  const { count } = await admin
    .from("messages")
    .select("id", { count: "exact", head: true })
    .eq("conversation_id", conversationId)
    // A conversation whose only message was deleted has nothing to continue,
    // so it reads as "not started" and the CTA stays Say hi.
    .is("deleted_at", null)
    .limit(1);
  return (count ?? 0) > 0;
}

/**
 * Resolve a mutual-connection notification for one viewer.
 *
 * Every check here is a re-check. Nothing is trusted from the notification.
 */
export async function resolveMutualDestination(
  admin: Admin,
  viewerId: string,
  connectionId: string
): Promise<MutualResolution> {
  const { data: connection } = await admin
    .from("linkr_connections")
    .select("id, user_low, user_high, conversation_id, ended_at")
    .eq("id", connectionId)
    .maybeSingle();

  // Gone, or ended by either person. Both mean there is nothing to open.
  if (!connection || connection.ended_at) return { kind: "unavailable" };

  // The viewer must actually be one of the two people. A notification id is
  // not proof of membership, and this is the check that stops a guessed or
  // forwarded id opening somebody else's connection.
  const isParticipant =
    connection.user_low === viewerId || connection.user_high === viewerId;
  if (!isParticipant) return { kind: "unavailable" };

  const otherUserId =
    connection.user_low === viewerId ? connection.user_high : connection.user_low;

  // A block placed AFTER the notification was written must win. This is the
  // whole reason the destination is resolved late rather than stored.
  if (await isBlockedEitherDirection(admin, viewerId, otherUserId)) {
    return { kind: "unavailable" };
  }

  const conversationId = connection.conversation_id ?? null;
  if (conversationId && (await conversationHasActivity(admin, conversationId))) {
    return { kind: "conversation", conversationId, otherUserId };
  }

  return { kind: "mutual", connectionId: connection.id, otherUserId, conversationId };
}
