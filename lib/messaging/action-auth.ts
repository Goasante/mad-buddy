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
 * twelve messaging action files, so the distinction cannot quietly drift
 * apart. The choice is stated by the NAME the action calls, and
 * `action-auth.test.ts` holds the exhaustive classification: every exported
 * messaging action belongs to exactly one of PURE_READ, SELF_ONLY,
 * AUTHORITATIVE or SAFE_EXCEPTIONS, and a new action fails the suite until
 * somebody classifies it.
 *
 * Not a `"use server"` module on purpose: these are internal helpers, not
 * actions, and exporting them as actions would put an auth primitive on the
 * public server-action surface.
 */

/**
 * A locally verified JWT. ~1ms, no network round trip.
 *
 * For low-risk messaging-context reads, and for writes to state that is
 * strictly private to the caller.
 *
 * "Reads" is broader than your own threads: it includes messageable-friend
 * discovery, structured-share options and reply context. "Private" means the
 * value authorizes nothing and no other account can observe it -- mute, pin,
 * hide, saved messages and per-conversation preferences. Both halves have to
 * hold. Writing your own row is NOT sufficient on its own:
 * `updateCommunicationPreferencesAction` writes only the caller's row and is
 * authoritative, because `messagePermission` decides whether other people may
 * open a conversation with the account.
 *
 * These paths run through service-role authority, so RLS is not what protects
 * them -- `resolveConversationAccess` is. It re-reads the caller's actual
 * `conversation_members` row on each request and refuses unless `status =
 * 'joined'`, which does not depend on how fresh the token is.
 *
 * ACCEPTED WINDOW, and it is a deliberate product decision rather than
 * something RLS solves: a globally signed-out or deleted account can keep
 * performing these reads, and keep toggling that private state, for up to 60
 * minutes -- the access token's lifetime. It cannot send, edit, change shared
 * state, alter authorization-affecting preferences, or do anything else
 * another account can observe.
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
 * Required for anything another account can SEE or that decides what another
 * account is ALLOWED to do -- sending, editing, deleting, forwarding,
 * reacting, polls, pins, presence (both setting and clearing it, so clearing
 * is never the weaker path), uploads, delivery and read receipts, shared chat
 * settings, communication preferences, and opening or creating a
 * conversation.
 *
 * The rule for any action added later: if its success is observable by, or
 * authorizes, an account other than the caller's, it uses THIS one.
 */
export async function getAuthoritativeMessagingUserId(): Promise<string | null> {
  const user = await getCurrentUserRecord();
  return user?.id ?? null;
}
