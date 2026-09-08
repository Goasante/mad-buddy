import { getCurrentIdentity, getCurrentUserRecord } from "@/lib/supabase/auth";

/**
 * WHICH AUTH ANSWER A MESSAGING ACTION IS ENTITLED TO.
 *
 * Messaging is not one risk class. Reading your own inbox and deleting a
 * message out of somebody else's screen are different operations, and an
 * earlier version of this split got that wrong by classifying per FILE --
 * every action in a file inherited one `getAuthedUserId`, so the security
 * choice was invisible at the call site and the next action added inherited
 * whatever happened to be there.
 *
 * These two live together, in one module rather than copied into each of the
 * four action files, so the distinction cannot quietly drift apart. The choice
 * is stated by the NAME the action calls.
 *
 * Not a `"use server"` module on purpose: these are internal helpers, not
 * actions, and exporting them as actions would put an auth primitive on the
 * public server-action surface.
 */

/**
 * A locally verified JWT. ~1ms, no network round trip.
 *
 * For PURE READS, and for writes that touch only the caller's OWN per-member
 * row where the effect is invisible to every other account.
 *
 * These paths run through service-role authority, so RLS is not what protects
 * them -- `resolveConversationAccess` is. It re-reads the caller's actual
 * `conversation_members` row on each request and refuses unless `status =
 * 'joined'`, which does not depend on how fresh the token is.
 *
 * ACCEPTED WINDOW, stated rather than implied: a globally signed-out or
 * deleted account can keep reading its OWN conversations, and keep toggling
 * its own mute / pin / hide / draft / presence-clear state, for up to 60
 * minutes -- the access token's lifetime. It cannot reach another account's
 * data, and it cannot change anything another account can observe.
 */
export async function getMessagingIdentityId(): Promise<string | null> {
  const identity = await getCurrentIdentity();
  return identity?.userId ?? null;
}

/**
 * The authoritative Supabase user record. A network round trip, and the point
 * of it: this is the only one that notices a global sign-out or a deleted
 * account.
 *
 * Required for anything another account can SEE -- sending, editing,
 * deleting, reacting, polls, pins, presence broadcast, uploads, shared chat
 * settings, and opening or creating a conversation.
 *
 * The rule for any action added later: if its success is observable by an
 * account other than the caller's, it uses THIS one.
 */
export async function getAuthoritativeMessagingUserId(): Promise<string | null> {
  const user = await getCurrentUserRecord();
  return user?.id ?? null;
}
