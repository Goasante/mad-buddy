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
  isVerifiedAccount: boolean;
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
  isVerifiedAccount: boolean;
  /** When THIS VIEWER chose them. Never anything about the other person. */
  clickedAt: string;
};

/** A profile this viewer explicitly chose "Don't show me again" for. */
export type HiddenProfile = {
  userId: string;
  displayName: string;
  photo: string | null;
  isVerifiedAccount: boolean;
  hiddenAt: string;
};

/** A support request created after the viewer has used their three self-service rewinds. */
export type LinkrRewindRequest = {
  id: string;
  targetUserId: string;
  targetDisplayName: string;
  targetPhoto: string | null;
  status: string;
  decision: "approve" | "reject" | null;
  createdAt: string;
  updatedAt: string;
};

function serverReady(): boolean {
  const env = getSupabaseServerEnv();
  return Boolean(env.url && env.serviceRoleKey);
}

async function describePeople(
  admin: Admin,
  userIds: string[]
): Promise<Map<string, { displayName: string; photo: string | null; isVerifiedAccount: boolean }>> {
  const described = new Map<string, { displayName: string; photo: string | null; isVerifiedAccount: boolean }>();
  if (userIds.length === 0) return described;

  const [{ data: profiles }, { data: verifications }] = await Promise.all([
    admin
      .from("profiles")
      .select("user_id, full_name, username, visibility_status, deleted_at")
      .in("user_id", userIds),
    admin
      .from("account_verifications")
      .select("user_id")
      .in("user_id", userIds)
      .eq("verification_type", "manual_review")
      .eq("status", "verified")
  ]);
  const verifiedIds = new Set((verifications ?? []).map((row) => row.user_id));

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
      photo: photoByUser.get(profile.user_id) ?? null,
      isVerifiedAccount: verifiedIds.has(profile.user_id)
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
 * ONE BOUNDED ROUND TRIP: `conversation_previews` returns exactly one row per
 * conversation, whatever the size of its history.
 *
 * Two wrong shapes were tried on the way here, and both are worth naming.
 * Originally this called `conversationHasActivity` once per connection, so a
 * 40-person collection cost 40 `messages` round trips. Replacing that with a
 * single `messages.select("conversation_id").in(...)` fixed the round trips and
 * introduced a worse problem: it transferred EVERY undeleted message row across
 * every Linkr conversation just to learn which ids appeared at least once. One
 * query, unbounded payload -- and Home pays it on every render.
 *
 * The RPC is the shape that is bounded in both directions. Its `lateral ...
 * limit 1` already filters `deleted_at is null`, so `last_created_at != null`
 * answers exactly the question this helper asks, and the deleted-message rule
 * survives unchanged: a conversation whose only message was deleted has no
 * last message, so it stays absent here and the CTA stays "Say hi".
 */
async function conversationsWithActivity(
  admin: Admin,
  viewerId: string,
  conversationIds: string[]
): Promise<Set<string>> {
  const unique = [...new Set(conversationIds)];
  if (unique.length === 0) return new Set();

  const { data } = await admin.rpc("conversation_previews", {
    p_user_id: viewerId,
    p_conversation_ids: unique
  });

  return new Set(
    (data ?? [])
      .filter((row) => row.last_created_at !== null)
      .map((row) => row.conversation_id)
  );
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
      viewerId,
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
      isVerifiedAccount: person.isVerifiedAccount,
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
      isVerifiedAccount: person.isVerifiedAccount,
      clickedAt: row.created_at
    });
  }
  return clicks;
}


/**
 * HIDDEN PROFILES: permanent Pass rows owned by this viewer.
 *
 * This is intentionally separate from blocked_users. Hiding says "do not put
 * this person back in my discovery deck"; blocking is the stronger account-
 * wide safety boundary. The list reads only the viewer's own permanent Passes.
 */
export async function loadHiddenProfiles(viewerId: string): Promise<HiddenProfile[]> {
  if (!serverReady()) return [];
  const admin = createSupabaseAdminClient();

  const { data: actions } = await admin
    .from("linkr_actions")
    .select("target_id, updated_at")
    .eq("actor_id", viewerId)
    .eq("action", "pass")
    .is("expires_at", null)
    .order("updated_at", { ascending: false });

  const rows = actions ?? [];
  if (rows.length === 0) return [];

  const described = await describePeople(
    admin,
    rows.map((row) => row.target_id)
  );

  const hidden: HiddenProfile[] = [];
  for (const row of rows) {
    const person = described.get(row.target_id);
    if (!person) continue;
    hidden.push({
      userId: row.target_id,
      displayName: person.displayName,
      photo: person.photo,
      isVerifiedAccount: person.isVerifiedAccount,
      hiddenAt: row.updated_at
    });
  }
  return hidden;
}

/**
 * The viewer's own Linkr rewind support requests, newest first.
 *
 * This is deliberately a tiny projection. It never exposes internal notes,
 * diagnostics, staff identity, or anything about the other person's Linkr
 * choices. The target id is already part of the viewer's own pass action; it
 * is used only to label which skipped profile the request refers to.
 */
export async function loadLinkrRewindRequests(viewerId: string): Promise<LinkrRewindRequest[]> {
  if (!serverReady()) return [];
  const admin = createSupabaseAdminClient();

  const { data: tickets } = await admin
    .from("support_tickets")
    .select("id, status, created_at, updated_at, diagnostics")
    .eq("user_id", viewerId)
    .eq("diagnostics->>workflow", "linkr_pass_reversal")
    .order("created_at", { ascending: false })
    .limit(8);

  const rows = tickets ?? [];
  if (rows.length === 0) return [];

  const targetByTicket = new Map<string, string>();
  for (const ticket of rows) {
    const diagnostics = ticket.diagnostics;
    if (!diagnostics || typeof diagnostics !== "object" || Array.isArray(diagnostics)) continue;
    const target = (diagnostics as Record<string, unknown>).target_user_id;
    if (typeof target === "string") targetByTicket.set(ticket.id, target);
  }

  const targetIds = [...new Set(targetByTicket.values())];
  const described = await describePeople(admin, targetIds);

  const decisionByTicket = new Map<string, "approve" | "reject">();
  const ticketIds = rows.map((ticket) => ticket.id);
  const { data: events } = await admin
    .from("support_ticket_events")
    .select("ticket_id, note, created_at")
    .in("ticket_id", ticketIds)
    .eq("event_type", "status_changed")
    .order("created_at", { ascending: false });
  for (const event of events ?? []) {
    if (decisionByTicket.has(event.ticket_id)) continue;
    const note = event.note?.toLowerCase() ?? "";
    if (note.includes("linkr rewind approved")) decisionByTicket.set(event.ticket_id, "approve");
    else if (note.includes("linkr rewind rejected")) decisionByTicket.set(event.ticket_id, "reject");
  }

  const requests: LinkrRewindRequest[] = [];
  for (const ticket of rows) {
    const targetUserId = targetByTicket.get(ticket.id);
    if (!targetUserId) continue;
    const person = described.get(targetUserId);
    requests.push({
      id: ticket.id,
      targetUserId,
      targetDisplayName: person?.displayName ?? "Profile unavailable",
      targetPhoto: person?.photo ?? null,
      status: ticket.status,
      decision: decisionByTicket.get(ticket.id) ?? null,
      createdAt: ticket.created_at,
      updatedAt: ticket.updated_at
    });
  }
  return requests;
}
