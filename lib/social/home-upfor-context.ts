import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

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
  ownerName: string;
  activityType: HangoutActivityType;
  activityLabel: string;
  /** The viewer's own request state on this session. */
  myStatus: "pending" | "accepted" | "maybe";
  startsAt: string | null;
  endsAt: string | null;
};

export type HomeUpForContext = {
  /** Live sessions the viewer owns, most recently started first. */
  ownedLive: HomeUpForOwnedSession[];
  /** Scheduled sessions the viewer owns, soonest first. */
  ownedScheduled: HomeUpForOwnedSession[];
  /** Sessions the viewer asked to join, and where that request stands. */
  joined: HomeUpForJoinedSession[];
};

const EMPTY: HomeUpForContext = { ownedLive: [], ownedScheduled: [], joined: [] };

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
      .select("id, status, hangout_session_id")
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
      .select("id, owner_id, activity_type, status, starts_at, ends_at")
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
        ownerName: nameById.get(session.owner_id) ?? "A Muddy",
        activityType: session.activity_type as HangoutActivityType,
        activityLabel: activityLabelFor(session.activity_type as HangoutActivityType),
        myStatus: request.status as HomeUpForJoinedSession["myStatus"],
        startsAt: session.starts_at,
        endsAt: session.ends_at
      });
    }
  }

  return { ownedLive, ownedScheduled, joined };
}
