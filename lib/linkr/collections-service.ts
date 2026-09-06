import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSupabaseServerEnv } from "@/lib/supabase/env";
import { batchBlockedIds } from "@/lib/social/permissions";
import { loadLinkrGalleries } from "@/lib/linkr/media-projection";

/**
 * The two persistent Linkr collections.
 *
 *   CLICKED     -- people this viewer and that person BOTH chose.
 *   YOUR CLICKS -- people this viewer chose, whatever they did back.
 *
 * Both are DERIVED from rows that already exist. There is no new table and no
 * new state column: Clicked is `linkr_connections`, Your clicks is this
 * viewer's own `linkr_actions`. A stored copy would be a second authority able
 * to disagree with the first.
 *
 * THE PRIVACY LINE, and it runs straight through this file:
 *
 *   Your clicks reads ONLY the viewer's own action rows. It never reads the
 *   other person's row, never joins to it, and never reports anything about
 *   it. So it cannot say "they haven't clicked you", "waiting for them", or
 *   "they passed" -- not because the copy avoids those words, but because the
 *   data to write them is never fetched. A person in Your clicks who has
 *   quietly reciprocated is indistinguishable from one who has not, until the
 *   connection itself appears in Clicked.
 */

type Admin = ReturnType<typeof createSupabaseAdminClient>;

export type ClickedPerson = {
  userId: string;
  connectionId: string;
  displayName: string;
  photo: string | null;
  connectedAt: string;
  /** Present only once the pair actually has somewhere to talk. */
  conversationId: string | null;
  /** Drives Say hi vs Continue chat. */
  hasConversation: boolean;
  /**
   * The Event this pair connected AT, when they connected through Event Mode.
   *
   * STORED, NEVER INFERRED. This is `linkr_connections.event_id`, written by
   * the mutual-connect transaction at the moment the pair matched. It is not
   * derived from overlapping attendance: two people who each happened to go to
   * the same Event, and connected through ordinary Linkr, have a null here and
   * must never be described as having met there.
   *
   * Null for every ordinary Linkr connection, and null when the Event has since
   * been deleted -- in which case the pair is still connected and simply has no
   * context line, rather than acquiring an invented one.
   */
  eventName: string | null;
};

export type PendingClick = {
  userId: string;
  displayName: string;
  photo: string | null;
  /** When THIS VIEWER chose them. Never anything about the other person. */
  clickedAt: string;
};

function serverReady(): boolean {
  const env = getSupabaseServerEnv();
  return Boolean(env.url && env.serviceRoleKey);
}

async function describePeople(
  admin: Admin,
  userIds: string[]
): Promise<Map<string, { displayName: string; photo: string | null }>> {
  const described = new Map<string, { displayName: string; photo: string | null }>();
  if (userIds.length === 0) return described;

  const { data: profiles } = await admin
    .from("profiles")
    .select("user_id, full_name, username, visibility_status, deleted_at")
    .in("user_id", userIds);

  // Media comes from the canonical Profile projection, so a face shown here is
  // the same stranger-safe face the candidate card was allowed to show.
  //
  // Batched: this used to call loadLinkrGallery once per profile, and that
  // helper itself runs a media lookup plus a signing call, so a 40-person
  // collection cost ~160 round trips to render. loadLinkrGalleries answers the
  // whole page with the same per-person rules.
  const galleries = await loadLinkrGalleries(
    admin,
    (profiles ?? []).map((profile) => profile.user_id)
  );
  const photoByUser = new Map(
    [...galleries].map(([userId, photos]) => [userId, photos[0] ?? null])
  );

  for (const profile of profiles ?? []) {
    // A deleted account is dropped entirely rather than rendered as a ghost.
    if (profile.deleted_at) continue;
    described.set(profile.user_id, {
      displayName: profile.full_name?.trim() || profile.username || "Someone",
      photo: photoByUser.get(profile.user_id) ?? null
    });
  }
  return described;
}

/** Blocks win here too: a blocked pair disappears from both collections.
 *
 *  One query for the whole collection. This previously called
 *  isBlockedEitherDirection once per person -- concurrently, so it was not a
 *  latency waterfall, but still one `blocked_users` round trip per card, which
 *  is what batchBlockedIds was written to replace. Identical semantics: the
 *  batched helper returns the ids blocked in EITHER direction, so the allowed
 *  set is its complement. */
async function withoutBlocked(
  admin: Admin,
  viewerId: string,
  userIds: string[]
): Promise<Set<string>> {
  const blocked = await batchBlockedIds(admin, viewerId, userIds);
  return new Set(userIds.filter((otherId) => !blocked.has(otherId)));
}

/**
 * Which of these conversations have a message anybody can still read.
 *
 * ONE query for the whole collection. This replaces a per-connection
 * `conversationHasActivity` call -- concurrent, but still one `messages` round
 * trip per card, so a 40-person collection cost 40 of them. Home now depends on
 * this reader for its Smart Card, which makes the shape worth fixing rather
 * than paying on every Home render.
 *
 * Semantics are unchanged, deliberately including the deleted-message rule: a
 * conversation whose only message was deleted has nothing to continue, so it is
 * absent here and the CTA stays "Say hi". Selecting the ids and building a set
 * asks the same question `count` did, for every conversation at once.
 */
async function conversationsWithActivity(
  admin: Admin,
  conversationIds: string[]
): Promise<Set<string>> {
  const unique = [...new Set(conversationIds)];
  if (unique.length === 0) return new Set();

  const { data } = await admin
    .from("messages")
    .select("conversation_id")
    .in("conversation_id", unique)
    .is("deleted_at", null);

  return new Set((data ?? []).map((row) => row.conversation_id));
}

/**
 * Names for the Events these pairs connected at.
 *
 * Batched over every distinct `event_id` on the collection, so Event context
 * costs one query rather than one per connection. A connection whose Event has
 * been deleted simply has no name and therefore no context line: the pair are
 * still connected, and inventing a label for a missing Event would be the one
 * thing worse than omitting it.
 */
async function describeConnectionEvents(
  admin: Admin,
  eventIds: readonly (string | null)[]
): Promise<Map<string, string>> {
  const unique = [...new Set(eventIds.filter((id): id is string => Boolean(id)))];
  if (unique.length === 0) return new Map();

  const { data } = await admin.from("events").select("id, name").in("id", unique);

  const byId = new Map<string, string>();
  for (const event of data ?? []) {
    const name = event.name?.trim();
    if (name) byId.set(event.id, name);
  }
  return byId;
}

/**
 * CLICKED: the mutual connections, newest first.
 *
 * These people are deliberately absent from Discover -- swiping on somebody
 * you already matched with is nonsense -- but absent from Discover must not
 * mean absent from Linkr, which is what it meant before this existed.
 */
export async function loadClickedPeople(viewerId: string): Promise<ClickedPerson[]> {
  if (!serverReady()) return [];
  const admin = createSupabaseAdminClient();

  const { data: connections } = await admin
    .from("linkr_connections")
    .select("id, user_low, user_high, conversation_id, connected_at, event_id")
    .or(`user_low.eq.${viewerId},user_high.eq.${viewerId}`)
    .is("ended_at", null)
    .order("connected_at", { ascending: false });

  const rows = connections ?? [];
  if (rows.length === 0) return [];

  const otherIds = rows.map((row) => (row.user_low === viewerId ? row.user_high : row.user_low));
  const [described, allowed, activity, eventNameById] = await Promise.all([
    describePeople(admin, otherIds),
    withoutBlocked(admin, viewerId, otherIds),
    conversationsWithActivity(
      admin,
      rows.map((row) => row.conversation_id).filter((id): id is string => Boolean(id))
    ),
    describeConnectionEvents(admin, rows.map((row) => row.event_id))
  ]);

  const people: ClickedPerson[] = [];
  for (const row of rows) {
    const otherId = row.user_low === viewerId ? row.user_high : row.user_low;
    if (!allowed.has(otherId)) continue;
    const person = described.get(otherId);
    if (!person) continue;
    people.push({
      userId: otherId,
      connectionId: row.id,
      displayName: person.displayName,
      photo: person.photo,
      connectedAt: row.connected_at,
      conversationId: row.conversation_id ?? null,
      hasConversation: row.conversation_id ? activity.has(row.conversation_id) : false,
      eventName: row.event_id ? eventNameById.get(row.event_id) ?? null : null
    });
  }
  return people;
}

/**
 * YOUR CLICKS: people this viewer chose who are not (yet) a connection.
 *
 * Reads `linkr_actions` for `actor_id = viewer` ONLY. The other person's row
 * is not queried, so nothing here can describe their side. Mutual pairs are
 * excluded because they have graduated to Clicked.
 */
export async function loadPendingClicks(viewerId: string): Promise<PendingClick[]> {
  if (!serverReady()) return [];
  const admin = createSupabaseAdminClient();

  const { data: actions } = await admin
    .from("linkr_actions")
    .select("target_id, created_at")
    .eq("actor_id", viewerId)
    .eq("action", "connect")
    .order("created_at", { ascending: false });

  const rows = actions ?? [];
  if (rows.length === 0) return [];

  // Anyone already connected belongs in Clicked, not here.
  const { data: connections } = await admin
    .from("linkr_connections")
    .select("user_low, user_high")
    .or(`user_low.eq.${viewerId},user_high.eq.${viewerId}`)
    .is("ended_at", null);
  const connected = new Set(
    (connections ?? []).map((row) => (row.user_low === viewerId ? row.user_high : row.user_low))
  );

  const pendingIds = rows.map((row) => row.target_id).filter((id) => !connected.has(id));
  if (pendingIds.length === 0) return [];

  const [described, allowed] = await Promise.all([
    describePeople(admin, pendingIds),
    withoutBlocked(admin, viewerId, pendingIds)
  ]);

  const clicks: PendingClick[] = [];
  for (const row of rows) {
    if (connected.has(row.target_id) || !allowed.has(row.target_id)) continue;
    const person = described.get(row.target_id);
    if (!person) continue;
    clicks.push({
      userId: row.target_id,
      displayName: person.displayName,
      photo: person.photo,
      clickedAt: row.created_at
    });
  }
  return clicks;
}
