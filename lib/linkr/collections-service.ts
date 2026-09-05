import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSupabaseServerEnv } from "@/lib/supabase/env";
import { batchBlockedIds } from "@/lib/social/permissions";
import { loadLinkrGalleries } from "@/lib/linkr/media-projection";
import { conversationHasActivity } from "@/lib/linkr/mutual-resolution";

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
    .select("id, user_low, user_high, conversation_id, connected_at")
    .or(`user_low.eq.${viewerId},user_high.eq.${viewerId}`)
    .is("ended_at", null)
    .order("connected_at", { ascending: false });

  const rows = connections ?? [];
  if (rows.length === 0) return [];

  const otherIds = rows.map((row) => (row.user_low === viewerId ? row.user_high : row.user_low));
  const [described, allowed] = await Promise.all([
    describePeople(admin, otherIds),
    withoutBlocked(admin, viewerId, otherIds)
  ]);

  const activity = new Map<string, boolean>();
  await Promise.all(
    rows.map(async (row) => {
      activity.set(
        row.id,
        row.conversation_id ? await conversationHasActivity(admin, row.conversation_id) : false
      );
    })
  );

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
      hasConversation: activity.get(row.id) ?? false
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
