import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { directConversationKey } from "@/lib/messaging/rules";
import { batchBlockedIds } from "@/lib/social/permissions";
import { HANGOUT_ACTIVITY_LABELS } from "@/lib/social/plans";
import { countPendingRequests } from "@/lib/social/hangout-requests";
import { isComingUpUpFor } from "@/lib/social/upfor-lifecycle";
import type { Database, HangoutActivityType } from "@/lib/supabase/database.types";

type Admin = SupabaseClient<Database>;

/**
 * Everything Home's Smart Card needs to know about UpFor, in one read.
 *
 * WHY THIS EXISTS RATHER THAN QUERIES INSIDE THE PROVIDERS. The UpFor reads
 * live in `app/(app)/hangout-actions.ts`, a Server Actions file Home cannot
 * import, so the alternative was copying three queries into the Smart Card
 * service -- a second UpFor system that would drift from the first the moment
 * a status or a lifecycle rule changed. This extracts the reads instead, and
 * decides nothing: the canonical predicates (`isComingUpUpFor`,
 * `countPendingRequests`, HANGOUT_ACTIVITY_LABELS) remain the authority.
 *
 * ONE BATCH, NOT PER-CARD FANOUT. Home already loads its domain facts once and
 * hands them to a pure selection pass. This follows that shape: a single
 * parallel batch here, no query behind any individual Smart Card state.
 *
 * MULTIPLE OWNED UPFORS ARE NORMAL. Nothing assumes one active session -- the
 * owner states summarise across everything the viewer owns, because a person
 * running a coffee and a gym UpFor at once is an ordinary case, not an edge.
 */

export type HomeUpForOwnedSession = {
  id: string;
  activityType: HangoutActivityType;
  /**
   * The canonical ACTIVITY label ("Coffee", "Gym"), not upForTitle().
   * upForTitle bakes in "now" -- correct for a live session, wrong on a card
   * that says an UpFor starts at 16:30.
   */
  activityLabel: string;
  startsAt: string | null;
  endsAt: string | null;
  /** Requests still waiting on the owner's answer. */
  pendingRequestCount: number;
  /** Requests the owner has accepted. */
  acceptedCount: number;
};

export type HomeUpForJoinedSession = {
  id: string;
  /**
   * The owner's user id, so an accepted card can offer to message THEM.
   *
   * Free: `owner_id` is already selected to resolve the owner's name and to
   * drop the viewer's own sessions, so carrying it costs no extra read.
   */
  ownerId: string;
  ownerName: string;
  activityType: HangoutActivityType;
  activityLabel: string;
  /** The viewer's own request state on this session. */
  myStatus: "pending" | "accepted" | "maybe";
  startsAt: string | null;
  endsAt: string | null;
  /**
   * Whether the viewer is CERTAIN to be an approved Muddy of the owner.
   *
   * Derived from the session's own audience, which `canViewHangout` already
   * enforces: every audience except `selected_groups` refuses a non-Muddy
   * outright, so being in the session at all proves mutuality for those. A
   * public Group UpFor is the one audience that deliberately reaches beyond
   * one social hop, so a joiner there may be a stranger.
   *
   * This is a CONSERVATIVE hint, not an authorization. Direct messaging
   * requires approved-Muddy or an active Linkr connection
   * (resolveDirectMessageEligibility), and that decision stays on the server at
   * click time. Home only uses this to avoid OFFERING a message it can already
   * tell would be refused -- and never to grant one.
   */
  ownerIsCertainMuddy: boolean;
  /**
   * Whether the viewer has ALREADY sent this owner a real message since the
   * moment their request was accepted.
   *
   * THE STATE AND THE JOB ARE DIFFERENT THINGS. `myStatus === "accepted"` is a
   * state, and it stays true for as long as the UpFor lives. "Message the
   * owner" is a JOB that state creates, and the job finishes the moment the
   * viewer actually writes to them. Home used to select on the state alone, so
   * it kept telling people to message somebody they had just messaged.
   *
   * Only a genuine, viewer-authored, non-system, non-deleted message in the
   * canonical direct conversation, sent AFTER acceptance, counts. Opening the
   * conversation does not, and yesterday chat does not: the recommendation is
   * "coordinate about THIS acceptance", so the evidence has to belong to it.
   *
   * False for a pending request, which has no such job yet.
   */
  coordinatedSinceAccepted: boolean;
};

/**
 * A Muddy UpFor the viewer can SEE but has not acted on yet.
 *
 * The discovery half of the lifecycle, which Home was missing entirely. The
 * catalog has always described `upfor_active_muddy` as "a relevant Muddy is
 * UpFor something now", but the wiring only ever looked at sessions the viewer
 * had ALREADY requested to join -- so the moment the card exists for, somebody
 * putting something out that you might want in on, never reached Home.
 */
export type HomeUpForOpportunity = {
  id: string;
  ownerId: string;
  ownerName: string;
  activityType: HangoutActivityType;
  activityLabel: string;
  endsAt: string;
};

export type HomeUpForContext = {
  /** Live sessions the viewer owns, most recently started first. */
  ownedLive: HomeUpForOwnedSession[];
  /** Scheduled sessions the viewer owns, soonest first. */
  ownedScheduled: HomeUpForOwnedSession[];
  /** Sessions the viewer asked to join, and where that request stands. */
  joined: HomeUpForJoinedSession[];
  /**
   * Live Muddy UpFors the viewer may see and has NOT requested to join.
   *
   * Muddies only, deliberately. Stranger/"nearby" discovery is the paid
   * expansion side of UpFor and it is expensive to resolve (per-viewer
   * proximity, stranger eligibility, an Access check); Home is not the surface
   * to pay for that on every render. Seeing what your own Muddies are up for is
   * your existing social world, and free.
   */
  opportunities: HomeUpForOpportunity[];
};

const EMPTY: HomeUpForContext = { ownedLive: [], ownedScheduled: [], joined: [], opportunities: [] };

/**
 * Cap on the coordination-evidence read.
 *
 * The viewer holds at most 12 join requests, so this is generous even if every
 * one were accepted and chatty. It exists so the query can never become an
 * unbounded history scan on the Home path, whatever the data does.
 */
const MAX_COORDINATION_EVIDENCE_ROWS = 60;

/** Caps on the opportunity read, so Home cost cannot grow with a social graph. */
const MAX_OPPORTUNITY_MUDDIES = 200;
const MAX_OPPORTUNITY_SESSIONS = 20;

/** "Coffee", "Gym" -- the noun, without upForTitle's "now" suffix. */
function activityLabelFor(activity: HangoutActivityType): string {
  return HANGOUT_ACTIVITY_LABELS[activity] ?? "Anything";
}

/**
 * A failed read must never blank Home. Every branch degrades to "no UpFor
 * context", which costs the viewer one card and not the screen.
 */
export async function loadHomeUpForContext(
  admin: Admin,
  viewerId: string,
  nowMs: number = Date.now()
): Promise<HomeUpForContext> {
  const [ownedResult, joinedResult] = await Promise.all([
    admin
      .from("hangout_sessions")
      .select("id, activity_type, status, starts_at, ends_at")
      .eq("owner_id", viewerId)
      .eq("status", "active")
      .order("starts_at", { ascending: true })
      .limit(12),
    admin
      .from("hangout_requests")
      .select("id, status, hangout_session_id, responded_at, created_at")
      .eq("requester_id", viewerId)
      .in("status", ["pending", "accepted", "maybe"])
      .limit(12)
  ]);

  if (ownedResult.error && joinedResult.error) return EMPTY;

  const ownedRows = ownedResult.data ?? [];
  const joinedRows = joinedResult.data ?? [];

  /* Request counts for every owned session in ONE read rather than one per
     session -- the fanout this whole module exists to avoid. */
  const ownedIds = ownedRows.map((row) => row.id);
  const requestsBySession = new Map<string, { status: string }[]>();
  if (ownedIds.length > 0) {
    const { data: requests } = await admin
      .from("hangout_requests")
      .select("hangout_session_id, status")
      .in("hangout_session_id", ownedIds)
      .in("status", ["pending", "accepted", "maybe"]);
    for (const request of requests ?? []) {
      const list = requestsBySession.get(request.hangout_session_id) ?? [];
      list.push({ status: request.status });
      requestsBySession.set(request.hangout_session_id, list);
    }
  }

  const owned: HomeUpForOwnedSession[] = ownedRows.map((row) => {
    const requests = requestsBySession.get(row.id) ?? [];
    return {
      id: row.id,
      activityType: row.activity_type as HangoutActivityType,
      activityLabel: activityLabelFor(row.activity_type as HangoutActivityType),
      startsAt: row.starts_at,
      endsAt: row.ends_at,
      pendingRequestCount: countPendingRequests(requests),
      acceptedCount: requests.filter((request) => request.status === "accepted").length
    };
  });

  /* The canonical lifecycle predicate decides scheduled-vs-live, exactly as
     Coming Up does. SQL narrows candidates; the predicate is the authority, so
     a new status added to the CHECK constraint cannot silently reclassify a
     session on Home. */
  const ownedScheduled = owned.filter((session) =>
    session.startsAt
      ? isComingUpUpFor(
          { status: "active", startsAt: session.startsAt, endsAt: session.endsAt ?? session.startsAt },
          nowMs
        )
      : false
  );
  const scheduledIds = new Set(ownedScheduled.map((session) => session.id));
  const ownedLive = owned.filter((session) => !scheduledIds.has(session.id));

  /* Sessions the viewer asked to join. Owner names and activity come from the
     session rows, so a request whose session has ended or been withdrawn
     simply drops out rather than rendering a card about nothing. */
  const joinedSessionIds = joinedRows.map((row) => row.hangout_session_id);
  const joined: HomeUpForJoinedSession[] = [];
  if (joinedSessionIds.length > 0) {
    const { data: sessions } = await admin
      .from("hangout_sessions")
      .select("id, owner_id, activity_type, status, starts_at, ends_at, audience_type")
      .in("id", joinedSessionIds)
      .eq("status", "active");

    const ownerIds = [...new Set((sessions ?? []).map((session) => session.owner_id))];
    const nameById = new Map<string, string>();
    if (ownerIds.length > 0) {
      const { data: profiles } = await admin
        .from("profiles")
        .select("user_id, full_name")
        .in("user_id", ownerIds);
      for (const profile of profiles ?? []) {
        nameById.set(profile.user_id, profile.full_name?.split(" ")[0] || "A Muddy");
      }
    }

    const sessionById = new Map((sessions ?? []).map((session) => [session.id, session]));
    for (const request of joinedRows) {
      const session = sessionById.get(request.hangout_session_id);
      if (!session) continue;
      // Never show the viewer their own session as something they joined.
      if (session.owner_id === viewerId) continue;
      joined.push({
        id: session.id,
        ownerId: session.owner_id,
        ownerName: nameById.get(session.owner_id) ?? "A Muddy",
        activityType: session.activity_type as HangoutActivityType,
        activityLabel: activityLabelFor(session.activity_type as HangoutActivityType),
        myStatus: request.status as HomeUpForJoinedSession["myStatus"],
        startsAt: session.starts_at,
        endsAt: session.ends_at,
        /* See ownerIsCertainMuddy. `selected_groups` is the only audience that
           admits somebody who is not already a Muddy, so it is the only one
           this cannot vouch for. */
        ownerIsCertainMuddy: session.audience_type !== "selected_groups",
        /* Filled in below, once for the whole batch. */
        coordinatedSinceAccepted: false
      });
    }
  }

  /* COMPLETION EVIDENCE, for the accepted sessions only.
     Bounded and batched: at most one extra pair of reads for the whole Home
     render, and nothing at all for a viewer with no accepted UpFor -- which is
     most of them. */
  await markCoordinatedSessions(admin, viewerId, joinedRows, joined);

  const requestedSessionIds = new Set(joinedRows.map((row) => row.hangout_session_id));
  const opportunities = await loadMuddyOpportunities(admin, viewerId, requestedSessionIds, nowMs);

  return { ownedLive, ownedScheduled, joined, opportunities };
}

/**
 * Live UpFors belonging to the viewer's Muddies that they have not acted on.
 *
 * BOUNDED, AND MUDDIES ONLY. `getVisibleHangoutsAction` is the canonical feed
 * and this deliberately does NOT call it: it resolves stranger proximity, runs
 * an Access check and filters two 50-row candidate sets through per-session
 * authorization. That is right for the UpFor screen and far too much for every
 * Home render.
 *
 * So this takes the cheap half of the same authority and none of the expensive
 * half:
 *
 *   - friendships the viewer already has (one read)
 *   - their Muddies' sessions that are ACTIVE, already STARTED and not ended
 *     (one read, capped)
 *   - `audience_type = all_muddies` only
 *
 * That last narrowing is what makes it safe without re-implementing anything.
 * `canViewHangout` refuses a non-Muddy for every audience except
 * `selected_groups`, and then narrows further per audience: `close_friends`
 * needs a close-friend edge, `selected_circles` a shared circle,
 * `selected_muddies` an explicit target row. Rather than duplicate those
 * lookups, Home asks only for the one audience where being a Muddy IS the whole
 * answer. Everything more specific stays on the UpFor screen, which already
 * resolves it properly. A narrower Home is the correct trade; a Home that
 * re-implements audience rules is not.
 *
 * Blocks are applied through the same batched helper the rest of the product
 * uses, so a blocked pair cannot surface here.
 */
async function loadMuddyOpportunities(
  admin: Admin,
  viewerId: string,
  requestedSessionIds: ReadonlySet<string>,
  nowMs: number
): Promise<HomeUpForOpportunity[]> {
  const { data: friendships } = await admin
    .from("friendships")
    .select("user_one_id, user_two_id")
    .or(`user_one_id.eq.${viewerId},user_two_id.eq.${viewerId}`)
    .is("ended_at", null)
    .limit(MAX_OPPORTUNITY_MUDDIES);

  const friendIds = [
    ...new Set(
      (friendships ?? []).map((row) =>
        row.user_one_id === viewerId ? row.user_two_id : row.user_one_id
      )
    )
  ].filter((id) => id !== viewerId);
  if (friendIds.length === 0) return [];

  const nowIso = new Date(nowMs).toISOString();
  const { data: sessions } = await admin
    .from("hangout_sessions")
    .select("id, owner_id, activity_type, ends_at")
    .in("owner_id", friendIds)
    .eq("status", "active")
    .eq("audience_type", "all_muddies")
    /* A scheduled UpFor is stored as `active` with a future starts_at, so
       discovery must also require that it has actually begun -- otherwise an
       18:00 session is announced from 14:00. Same rule as the canonical feed. */
    .lte("starts_at", nowIso)
    .gt("ends_at", nowIso)
    .order("ends_at", { ascending: true })
    .limit(MAX_OPPORTUNITY_SESSIONS);

  /* Sessions the viewer has already acted on are not opportunities -- they are
     the pending/accepted states, which own those moments. */
  const candidates = (sessions ?? []).filter((session) => !requestedSessionIds.has(session.id));
  if (candidates.length === 0) return [];

  const ownerIds = [...new Set(candidates.map((session) => session.owner_id))];
  const [blocked, { data: profiles }] = await Promise.all([
    batchBlockedIds(admin, viewerId, ownerIds),
    admin
      .from("profiles")
      .select("user_id, full_name, visibility_status, deleted_at")
      .in("user_id", ownerIds)
  ]);

  const nameById = new Map<string, string>();
  for (const profile of profiles ?? []) {
    if (profile.deleted_at || profile.visibility_status === "ghost") continue;
    nameById.set(profile.user_id, profile.full_name?.split(" ")[0] || "A Muddy");
  }

  const opportunities: HomeUpForOpportunity[] = [];
  for (const session of candidates) {
    if (blocked.has(session.owner_id)) continue;
    const ownerName = nameById.get(session.owner_id);
    if (!ownerName) continue;
    opportunities.push({
      id: session.id,
      ownerId: session.owner_id,
      ownerName,
      activityType: session.activity_type as HangoutActivityType,
      activityLabel: activityLabelFor(session.activity_type as HangoutActivityType),
      endsAt: session.ends_at
    });
  }
  return opportunities;
}

/**
 * Which accepted UpFors the viewer has already coordinated about.
 *
 * WHY THIS IS NOT A MESSAGE-HISTORY SCAN. The question is a boolean per
 * accepted session -- did they write to this owner after acceptance? -- and
 * answering it by loading conversations would put a person message history on
 * the Home path. Instead:
 *
 *   1. resolve the canonical direct conversation for each accepted owner by
 *      `direct_key`, which is unique per pair (one `.in()`);
 *   2. ask for the viewer own qualifying messages in those conversations,
 *      newest first, capped (one `.in()`).
 *
 * Two reads for the whole batch, both keyed on indexed columns, neither growing
 * with the size of any conversation. A viewer with no accepted UpFor pays
 * nothing: the function returns before either query.
 *
 * WHAT COUNTS, deliberately narrow:
 *   - the viewer is the sender (their coordination, not the owner reply)
 *   - `message_type` is not `system` (a lifecycle event is not a person)
 *   - `deleted_at` is null (a retracted message coordinated nothing)
 *   - `created_at` is after the acceptance timestamp
 *
 * `responded_at` is nullable on legacy rows. Those fall back to the request
 * `created_at`, which is conservative in the safe direction: an older threshold
 * can only make MORE messages qualify, so the worst case is retiring a card
 * slightly early rather than nagging somebody who has already written.
 */
async function markCoordinatedSessions(
  admin: Admin,
  viewerId: string,
  requestRows: readonly {
    hangout_session_id: string;
    status: string;
    responded_at: string | null;
    created_at: string | null;
  }[],
  joined: HomeUpForJoinedSession[]
): Promise<void> {
  const acceptedSessions = joined.filter((session) => session.myStatus === "accepted");
  if (acceptedSessions.length === 0) return;

  const acceptedAtBySession = new Map<string, number>();
  for (const row of requestRows) {
    if (row.status !== "accepted") continue;
    const stamp = row.responded_at ?? row.created_at ?? null;
    const ms = stamp ? Date.parse(stamp) : Number.NaN;
    acceptedAtBySession.set(row.hangout_session_id, Number.isFinite(ms) ? ms : 0);
  }

  const ownerBySession = new Map(acceptedSessions.map((session) => [session.id, session.ownerId]));
  const keyByOwner = new Map<string, string>();
  for (const ownerId of new Set(ownerBySession.values())) {
    keyByOwner.set(directConversationKey(viewerId, ownerId), ownerId);
  }

  const { data: conversations } = await admin
    .from("conversations")
    .select("id, direct_key")
    .eq("conversation_type", "direct")
    .in("direct_key", [...keyByOwner.keys()]);

  const conversationIdByOwner = new Map<string, string>();
  for (const conversation of conversations ?? []) {
    const ownerId = conversation.direct_key ? keyByOwner.get(conversation.direct_key) : undefined;
    if (ownerId) conversationIdByOwner.set(ownerId, conversation.id);
  }
  if (conversationIdByOwner.size === 0) return;

  const { data: messages } = await admin
    .from("messages")
    .select("conversation_id, created_at")
    .in("conversation_id", [...conversationIdByOwner.values()])
    .eq("sender_id", viewerId)
    .neq("message_type", "system")
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(MAX_COORDINATION_EVIDENCE_ROWS);

  /* The NEWEST qualifying message per conversation is all that matters: if the
     latest one predates acceptance, none of the older ones can postdate it. */
  const latestByConversation = new Map<string, number>();
  for (const message of messages ?? []) {
    const ms = Date.parse(message.created_at);
    if (!Number.isFinite(ms)) continue;
    const current = latestByConversation.get(message.conversation_id) ?? 0;
    if (ms > current) latestByConversation.set(message.conversation_id, ms);
  }

  for (const session of acceptedSessions) {
    const conversationId = conversationIdByOwner.get(session.ownerId);
    if (!conversationId) continue;
    const latest = latestByConversation.get(conversationId);
    if (latest === undefined) continue;
    const acceptedAt = acceptedAtBySession.get(session.id);
    if (acceptedAt === undefined) continue;
    session.coordinatedSinceAccepted = latest > acceptedAt;
  }
}
