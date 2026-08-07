import "server-only";

import { emitLifeEvents } from "@/lib/life/emit";
import type { LifeEventInput } from "@/lib/life/events";
import { planAttendancePairs } from "@/lib/life/plan-attendance";
import type { createSupabaseAdminClient } from "@/lib/supabase/admin";

type Admin = ReturnType<typeof createSupabaseAdminClient>;

/**
 * Projection rebuild.
 *
 * The recovery story for Life: because the timeline is a pure function of
 * `domain_events`, and because emission is compensating (a failed event never
 * rolls back the action it described), the log can fall behind reality. This
 * replays the SOURCE TABLES — friendships, close friends — back into the
 * event stream.
 *
 * Safe to run at any time. Every event carries a stable dedupe key derived
 * from the relationship and a natural key, so replaying an event that already
 * exists is a no-op at the unique index. Running this twice produces the same
 * result as running it once.
 *
 * Nothing here deletes or mutates: `domain_events` is append-only and a
 * database trigger enforces it. Rebuild only ever adds what is missing.
 */

export type RebuildSummary = {
  considered: number;
  recorded: number;
  duplicates: number;
  failed: number;
};

const EMPTY: RebuildSummary = { considered: 0, recorded: 0, duplicates: 0, failed: 0 };

/**
 * Replay the friendship facts for one relationship pair.
 *
 * `created` and `ended` come straight from the friendships row, so the
 * timestamps are the real ones rather than "now" — a rebuild must not rewrite
 * history to the moment it ran.
 */
export async function rebuildRelationship(
  admin: Admin,
  userA: string,
  userB: string
): Promise<RebuildSummary> {
  const [first, second] = [userA, userB].sort();

  const { data: friendship } = await admin
    // LIFE-HISTORICAL: replay needs ended friendships too — that is the whole
    // point of a timeline that survives unfriending.
    .from("friendships")
    .select("user_one_id, user_two_id, created_at, ended_at")
    .eq("user_one_id", first!)
    .eq("user_two_id", second!)
    .maybeSingle();

  if (!friendship) return EMPTY;

  const inputs: LifeEventInput[] = [
    {
      eventType: "relationship.created",
      actorId: friendship.user_one_id,
      subjectId: friendship.user_two_id,
      // The pair itself is the natural key: a friendship is created once.
      naturalKey: "created",
      occurredAt: friendship.created_at
    }
  ];

  if (friendship.ended_at) {
    inputs.push({
      eventType: "relationship.ended",
      actorId: friendship.user_one_id,
      subjectId: friendship.user_two_id,
      naturalKey: "ended",
      occurredAt: friendship.ended_at
    });
  }
  // REACTIVATION IS NOT REPLAYED, and this is a deliberate limit rather than
  // an oversight.
  //
  // `friendships` keeps one row per pair with a single `ended_at`, so an
  // active row is indistinguishable from a row that ended and reactivated:
  // both read as ended_at IS NULL. The cycles are recorded only as events, by
  // the accept path, at the moment they happen.
  //
  // Replaying a reactivation from the row would therefore mean guessing when
  // it occurred — inventing a date the database never stored. The events that
  // were emitted live are already in `domain_events` and are never deleted, so
  // a rebuild ADDS the facts that can be derived and leaves the ones that
  // cannot exactly where they are. Rebuild repairs gaps; it does not
  // reconstruct what was never recorded.

  // Close-friend status is one-directional and private to the owner, so each
  // side is replayed under its own actor.
  const { data: closeFriends } = await admin
    .from("close_friend_relationships")
    .select("owner_id, friend_id, created_at")
    .or(
      `and(owner_id.eq.${first},friend_id.eq.${second}),and(owner_id.eq.${second},friend_id.eq.${first})`
    );

  for (const row of closeFriends ?? []) {
    inputs.push({
      eventType: "relationship.close_friend_added",
      actorId: row.owner_id,
      subjectId: row.friend_id,
      // Keyed by owner so both directions can coexist without colliding.
      naturalKey: `added:${row.owner_id}`,
      occurredAt: row.created_at
    });
  }

  inputs.push(...(await planAttendanceInputs(admin, first!, second!)));

  const result = await emitLifeEvents(admin, inputs);
  return { considered: inputs.length, ...result };
}

/**
 * Replay `plan.attended_together` for one pair.
 *
 * Finds the completed plans BOTH people were going to, then runs the same pure
 * pairing function the live job uses, so a replay can never produce a pair the
 * live path would not have.
 *
 * Each plan is paired under its own completion time rather than one shared
 * "now": a rebuild must not restamp every past plan to the moment it ran.
 * `completed_at` is preferred and `end_at` is the fallback, because the
 * completion job sets `status` and `updated_at` but not `completed_at`, so
 * older rows have only the scheduled end to go on.
 */
async function planAttendanceInputs(
  admin: Admin,
  first: string,
  second: string
): Promise<LifeEventInput[]> {
  const { data: rows } = await admin
    .from("plan_participants")
    .select("plan_id, user_id, plans!inner(status, completed_at, end_at)")
    .in("user_id", [first, second])
    .eq("rsvp_status", "going")
    .eq("plans.status", "completed");

  const attendedBy = new Map<string, { users: Set<string>; occurredAt: string | null }>();
  for (const row of rows ?? []) {
    // The !inner join returns the plan as an object; the generated types widen
    // it to an array in some shapes, so normalise before reading.
    const plan = (Array.isArray(row.plans) ? row.plans[0] : row.plans) as
      | { completed_at: string | null; end_at: string | null }
      | undefined;
    if (!attendedBy.has(row.plan_id)) {
      attendedBy.set(row.plan_id, {
        users: new Set(),
        occurredAt: plan?.completed_at ?? plan?.end_at ?? null
      });
    }
    attendedBy.get(row.plan_id)!.users.add(row.user_id);
  }

  const inputs: LifeEventInput[] = [];
  for (const [planId, entry] of attendedBy) {
    // Only plans BOTH of them attended are a shared fact.
    if (!entry.users.has(first) || !entry.users.has(second)) continue;
    // A plan with no usable timestamp is skipped rather than dated to now —
    // an invented date is worse than a missing event, and the event can be
    // replayed once the source row is fixed.
    if (!entry.occurredAt) continue;
    inputs.push(
      ...planAttendancePairs(
        [
          { planId, userId: first },
          { planId, userId: second }
        ],
        entry.occurredAt
      )
    );
  }
  return inputs;
}

/**
 * Replay every relationship one user is part of.
 *
 * Bounded by `limit` so a rebuild for a very connected account cannot run
 * unbounded inside a request.
 */
export async function rebuildUser(admin: Admin, userId: string, limit = 200): Promise<RebuildSummary> {
  const { data: friendships } = await admin
    // LIFE-HISTORICAL: every relationship the user has ever had.
    .from("friendships")
    .select("user_one_id, user_two_id")
    .or(`user_one_id.eq.${userId},user_two_id.eq.${userId}`)
    .limit(limit);

  const summary = { ...EMPTY };
  for (const row of friendships ?? []) {
    const partial = await rebuildRelationship(admin, row.user_one_id, row.user_two_id);
    summary.considered += partial.considered;
    summary.recorded += partial.recorded;
    summary.duplicates += partial.duplicates;
    summary.failed += partial.failed;
  }
  return summary;
}

/**
 * Replay a batch of relationships across the whole product.
 *
 * Deliberately paged rather than "all": a full rebuild on a large database
 * belongs in a job that can be resumed, not a single call. `offset` lets a
 * caller walk through.
 */
export async function rebuildAll(admin: Admin, { limit = 100, offset = 0 } = {}): Promise<RebuildSummary> {
  const { data: friendships } = await admin
    // LIFE-HISTORICAL: a full replay covers ended relationships too.
    .from("friendships")
    .select("user_one_id, user_two_id")
    .order("created_at", { ascending: true })
    .range(offset, offset + limit - 1);

  const summary = { ...EMPTY };
  for (const row of friendships ?? []) {
    const partial = await rebuildRelationship(admin, row.user_one_id, row.user_two_id);
    summary.considered += partial.considered;
    summary.recorded += partial.recorded;
    summary.duplicates += partial.duplicates;
    summary.failed += partial.failed;
  }
  return summary;
}
