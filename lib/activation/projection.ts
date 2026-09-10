import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSupabaseServerEnv } from "@/lib/supabase/env";
import { loadNearbyForUser } from "@/lib/proximity/nearby-service";
import { getUnreadMessageCount } from "@/lib/messaging/mobile";
import type { SafeNearbyFriend } from "@/lib/proximity/backend";
import {
  selectRelationshipFocus,
  type RelationshipFocus
} from "@/lib/activation/relationship-focus";
import {
  hasLocationSetupEvidence,
  isLocationFreshForProximity
} from "@/lib/proximity/freshness";
import {
  resolveActivationState,
  shouldAcknowledgeFirstMuddy,
  shouldTeachGlow,
  type ActivationInputs,
  type ActivationState
} from "@/lib/activation/state";

/**
 * The facts Home needs to know what to say, gathered once.
 *
 * COMPOSES CANONICAL SOURCES, adds none. Muddy count, nearby people, upcoming
 * Plans and milestones each already have an owner; this asks them, it does not
 * re-implement them. A second definition of "how many Muddies do I have" is
 * how two surfaces start disagreeing.
 *
 * BATCHED. Everything below runs in one Promise.all, so deciding what Home
 * leads with costs one round trip rather than one per question.
 */

export type ActivationProjection = {
  /**
   * Whether this projection reflects a real read, or a failure Home must not
   * mistake for a real answer.
   *
   * THE BUG THIS EXISTS TO PREVENT: `EMPTY` below is bit-for-bit identical to
   * a genuine brand-new account (no Muddies, no location, nothing). Before
   * this field existed, a missing service-role credential or a failed query
   * for one established user produced exactly the shape a real first-day
   * account produces, and every caller -- `resolveActivationState`,
   * `composeHome`, the Smart Card arbiter -- had no way to tell the two
   * apart. They agreed, confidently and wrongly, that the account had never
   * done anything, and suppressed Near, Trending, Suggestions and the Smart
   * Card together for people who had been using the product for months.
   *
   * "unavailable" means: do not trust `state`, do not trust the zeroed
   * counts, and do not let this collapse an established account into
   * onboarding. Callers that receive "unavailable" should treat activation
   * as having nothing to say (i.e. behave as they already do for
   * `state: null`) rather than as having confirmed a fresh account.
   */
  status: "ok" | "unavailable";
  state: ActivationState;
  teachGlow: boolean;
  muddyCount: number;
  pendingOutgoingCount: number;
  nearbyMuddyCount: number;
  /**
   * The privacy-safe nearby projection itself, not just its size.
   *
   * Home used to receive only the COUNT and then ask the browser to fetch the
   * same people again -- so a screen the server could have rendered complete
   * started from zero, and any client-side emptiness left it showing anonymous
   * placeholders for people the server already knew. Same shape the nearby
   * route returns: bands, never coordinates.
   */
  nearby: SafeNearbyFriend[];
  upcomingPlanCount: number;
  locationGranted: boolean;
  /** Direct conversations where both people have written. Maturity evidence. */
  twoSidedConversationCount: number;
  /**
   * Conversations with something unread (MB-GOD-052).
   *
   * THE CANONICAL AUTHORITY, not a second definition. `getUnreadMessageCount`
   * reads the same `conversation_previews` RPC the inbox and the nav badge use,
   * and carries a documented correction about `status = 'joined'` that a
   * hand-rolled count here would lose. Home only needs to know whether somebody
   * is waiting; it does not display the number.
   */
  unreadConversationCount: number;
  /** Plans this person is on, past or upcoming. Maturity evidence. */
  planParticipationCount: number;
  /** Whether the viewer's own fix can support a claim about who is nearby. */
  locationFreshForProximity: boolean;
  milestones: string[];
  /** True only while the first-Muddy moment is still recent. */
  acknowledgeFirstMuddy: boolean;
  /** Who it was with. Null unless the acknowledgement is live.
   *
   * `id` carries so the card can offer "Say hi" on that person (MB-GOD-050).
   * It comes from the listMuddies call this branch already makes, so nothing
   * extra is fetched to get it. */
  firstMuddy: { id: string; displayName: string; avatarUrl: string | null } | null;
  /**
   * The relationship Home should name, and what to offer for it.
   *
   * Null unless the quiet-evening card is what is being shown, so an ordinary
   * Home never pays for the lookup.
   */
  relationshipFocus: RelationshipFocus | null;
};

/** Everything absent, for a misconfigured read (see `loadActivationProjection`
 *  -- the only caller, and it is only ever invoked for a signed-in user, so
 *  this path means the service-role credential is missing, never "logged
 *  out"). Fails to the state that blocks nothing and asks for the least, but
 *  `status: "unavailable"` so a caller does not mistake this shape for a real
 *  brand-new account -- see the comment on `status` above. */
const EMPTY: ActivationProjection = {
  status: "unavailable",
  state: "no_muddies",
  teachGlow: false,
  muddyCount: 0,
  pendingOutgoingCount: 0,
  nearbyMuddyCount: 0,
  nearby: [],
  upcomingPlanCount: 0,
  locationGranted: false,
  locationFreshForProximity: false,
  milestones: [],
  acknowledgeFirstMuddy: false,
  firstMuddy: null,
  relationshipFocus: null,
  twoSidedConversationCount: 0,
  unreadConversationCount: 0,
  planParticipationCount: 0
};

/**
 * The relationship Home should name, with the facts needed to choose an action.
 *
 * THREE BATCHED READS, NOT ONE PER MUDDY. Conversations are found by their
 * deterministic `direct_key`, so every candidate is resolved in a single `in`
 * query rather than a lookup each. Plans and Waves are the same shape.
 *
 * SAFE IDENTITY ONLY. Name and avatar come from the Muddies projection that
 * already exists; nothing here reads a coordinate, a band or a distance.
 */
async function loadRelationshipFocus(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  userId: string
): Promise<RelationshipFocus | null> {
  const [{ listMuddies }, { directConversationKey }, { WAVE_PAIR_COOLDOWN_MS }] = await Promise.all([
    import("@/lib/friends/service"),
    import("@/lib/messaging/rules"),
    import("@/lib/social/rules")
  ]);

  const { muddies } = await listMuddies(userId);
  if (muddies.length === 0) return null;

  const ids = muddies.map((m) => m.id);
  const keyById = new Map(ids.map((id) => [directConversationKey(userId, id), id]));
  const nowMs = Date.now();

  const [{ data: friendships }, { data: conversations }, { data: waves }, { data: sharedPlans }] =
    await Promise.all([
      // When each friendship began: the deterministic newest-first tiebreak.
      admin
        .from("friendships")
        .select("user_one_id, user_two_id, created_at")
        .or(`user_one_id.eq.${userId},user_two_id.eq.${userId}`)
        .is("ended_at", null),
      admin
        .from("conversations")
        .select("id, direct_key, last_message_at")
        .eq("conversation_type", "direct")
        .in("direct_key", [...keyById.keys()]),
      /* Only Waves inside the cooldown window matter.
       *
       * `recipient_id` and `sent_at` are the canonical column names, matching
       * sendWaveV2Action's own lookup -- taking the same window from the same
       * fields is what stops this offering a Wave the server would refuse. */
      admin
        .from("waves")
        .select("recipient_id, sent_at")
        .eq("sender_id", userId)
        .in("recipient_id", ids)
        .gte("sent_at", new Date(nowMs - WAVE_PAIR_COOLDOWN_MS).toISOString()),
      /* UPCOMING and not cancelled, both enforced here.
       *
       * `plan_participants` carries no time, so filtering on membership alone
       * would count a dinner from last month -- and "you already have a plan
       * with them" is exactly the claim that must not be made about something
       * finished or called off. */
      admin
        .from("plan_participants")
        .select("plan_id, user_id, plans!inner(start_at, cancelled_at)")
        .in("user_id", [userId, ...ids])
        .in("rsvp_status", ["going", "maybe", "invited"])
        .is("plans.cancelled_at", null)
        .gte("plans.start_at", new Date(nowMs).toISOString())
    ]);

  const connectedAt = new Map<string, number>();
  for (const row of friendships ?? []) {
    const other = row.user_one_id === userId ? row.user_two_id : row.user_one_id;
    connectedAt.set(other, Date.parse(row.created_at));
  }

  /* A ROW IS NOT A CONVERSATION.
   *
   * Tapping "Say hi" creates the conversation before anybody has said
   * anything, so treating the row's existence as evidence flipped the button
   * to "Message" for a thread that was still completely empty -- the app
   * claiming a conversation had happened because it had opened a door.
   *
   * The evidence is a real user message. `conversations.last_message_at` will
   * not do: system events advance it too, which is exactly why
   * last_user_message_at exists elsewhere in messaging. Counting non-system
   * messages directly asks the same question of the same source. */
  const conversationIdByMuddy = new Map<string, string>();
  for (const row of conversations ?? []) {
    const muddyId = keyById.get(row.direct_key ?? "");
    if (muddyId) conversationIdByMuddy.set(muddyId, row.id);
  }

  const conversationIds = [...conversationIdByMuddy.values()];
  // No threads at all: skip the query rather than sending an empty `in`.
  const { data: userMessages } = conversationIds.length
    ? await admin
        // sender_id too: WHO spoke is what separates "we said hello" from
        // "we talk", and a reply is the only thing that shows both sides.
        .from("messages")
        .select("conversation_id, sender_id, created_at")
        .in("conversation_id", conversationIds)
        .neq("message_type", "system")
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
    : { data: [] };

  const newestUserMessageAt = new Map<string, number>();
  /* Who has spoken in each thread. Two distinct senders means somebody
   * replied, which is the difference between talking and waiting. */
  const sendersByConversation = new Map<string, Set<string>>();
  for (const row of userMessages ?? []) {
    // Ordered newest-first, so the first row per conversation wins.
    if (!newestUserMessageAt.has(row.conversation_id)) {
      newestUserMessageAt.set(row.conversation_id, Date.parse(row.created_at));
    }
    if (!row.sender_id) continue;
    const senders = sendersByConversation.get(row.conversation_id) ?? new Set<string>();
    senders.add(row.sender_id);
    sendersByConversation.set(row.conversation_id, senders);
  }

  const conversationByMuddy = new Map<
    string,
    { lastMessageAtMs: number; conversationState: "started" | "established" }
  >();
  for (const [muddyId, conversationId] of conversationIdByMuddy) {
    const activityMs = newestUserMessageAt.get(conversationId);
    // Absent means the thread exists but nobody has spoken in it yet.
    if (activityMs === undefined) continue;
    const senders = sendersByConversation.get(conversationId) ?? new Set<string>();
    conversationByMuddy.set(muddyId, {
      lastMessageAtMs: activityMs,
      /* A reply, not a message count. Somebody who sent three messages into
       * silence is still waiting; suggesting a plan there would be worse. */
      conversationState: senders.size > 1 ? "established" : "started"
    });
  }

  const wavedRecently = new Set((waves ?? []).map((row) => row.recipient_id));

  /* A plan is SHARED only when both people are on it. Counting a plan the
   * viewer merely attends would recommend "open the plan" for somebody who
   * has nothing to do with it. */
  const viewerPlanIds = new Set(
    (sharedPlans ?? []).filter((row) => row.user_id === userId).map((row) => row.plan_id)
  );
  const sharedWith = new Set(
    (sharedPlans ?? [])
      .filter((row) => row.user_id !== userId && viewerPlanIds.has(row.plan_id))
      .map((row) => row.user_id)
  );

  return selectRelationshipFocus(
    muddies.map((m) => {
      const conversation = conversationByMuddy.get(m.id);
      return {
        id: m.id,
        displayName: m.displayName,
        avatarUrl: m.avatarUrl,
        connectedAtMs: connectedAt.get(m.id) ?? 0,
        hasSharedUpcomingPlan: sharedWith.has(m.id),
        conversationState: conversation?.conversationState ?? "none",
        lastConversationActivityMs: conversation?.lastMessageAtMs ?? null,
        waveAvailable: !wavedRecently.has(m.id)
      };
    })
  );
}

/**
 * How much of Mad Buddy this person has actually used.
 *
 * TWO CHEAP READS. A conversation counts as two-sided when two distinct people
 * have written in it -- a reply, not a message count, because one person
 * talking into silence is not yet a relationship. Plan participation is any
 * plan they are on, past or upcoming: having arranged to meet somebody is
 * evidence of understanding the product whether or not it already happened.
 *
 * BACKWARD COMPATIBLE BY CONSTRUCTION. Both signals are real activity rather
 * than milestone keys, so an account that predates the milestones still reads
 * as experienced -- which is what stops the future Experience Migration from
 * re-onboarding its most established users.
 */
async function loadMaturityEvidence(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  userId: string
): Promise<{ twoSidedConversationCount: number; planParticipationCount: number }> {
  /* THE MILESTONE, not a history scan (MB-GOD-060).
   *
   * This used to read `conversation_id, sender_id` for every non-system,
   * non-deleted message in every direct conversation the user belongs to, then
   * group them in memory to answer one question: has any conversation ever had
   * two different senders? That is O(total messages ever exchanged) on EVERY
   * Home load -- no window, no limit.
   *
   * `home-maturity.ts` only ever compares the result `> 0`; the count itself is
   * never used. And the fact is monotonic -- `looksEstablished` asks what
   * somebody has EVER experienced -- so it belongs in `activation_milestones`,
   * written once when it becomes true by the `messages` trigger, and backfilled
   * for existing accounts by the same migration.
   *
   * The return type keeps its shape so nothing downstream changes: 1 stands for
   * "at least one", which is the only distinction any caller draws. */
  const [{ data: replyMilestone }, { count: planParticipationCount }] = await Promise.all([
    admin
      .from("activation_milestones")
      .select("id")
      .eq("user_id", userId)
      .eq("milestone", "first_reply_received")
      .limit(1),
    admin
      .from("plan_participants")
      .select("plan_id", { count: "exact", head: true })
      .eq("user_id", userId)
      .in("rsvp_status", ["going", "maybe", "invited"])
  ]);

  return {
    twoSidedConversationCount: (replyMilestone ?? []).length > 0 ? 1 : 0,
    planParticipationCount: planParticipationCount ?? 0
  };
}

export async function loadActivationProjection(userId: string): Promise<ActivationProjection> {
  const env = getSupabaseServerEnv();
  if (!env.url || !env.serviceRoleKey) return EMPTY;

  const admin = createSupabaseAdminClient();

  /* NEARBY IS ALLOWED TO FAIL WITHOUT TAKING THE REST DOWN.
   *
   * `loadNearbyForUser` does not surface `.error` itself (see that module),
   * so a thrown rejection here is the one way it can fail loudly. Caught
   * separately from the batched reads below so a nearby outage cannot be
   * mistaken for "everything failed" -- the muddy count, milestones and
   * maturity evidence may all have loaded fine even when this one did not. */
  let nearbyFailed = false;
  const nearbyPromise = loadNearbyForUser(admin, userId).catch(() => {
    nearbyFailed = true;
    return [] as SafeNearbyFriend[];
  });

  const [
    muddyResult,
    { data: milestoneRows },
    { data: profile },
    { count: pendingOutgoingCount },
    { data: viewerLocation },
    nearby,
    planResult
  ] = await Promise.all([
      /* Live friendships only, counted the way listMuddies counts them.
       *
       * A friendship row is the pair, so membership is either side of it, and
       * `ended_at is null` is what "still Muddies" means -- the same predicate
       * the Muddies list uses. A request still in flight has no row here at
       * all, so it cannot move somebody into a state whose payoff has not
       * arrived. */
      admin
        .from("friendships")
        .select("id", { count: "exact", head: true })
        .or(`user_one_id.eq.${userId},user_two_id.eq.${userId}`)
        .is("ended_at", null),
      // reached_at, not just the name: recency is what decides whether the
      // first-Muddy moment is still worth acknowledging.
      admin.from("activation_milestones").select("milestone, reached_at").eq("user_id", userId),
      admin.from("profiles").select("visibility_status").eq("user_id", userId).maybeSingle(),
      /* Requests this person sent that nobody has answered.
       *
       * Distinguishes "has done nothing" from "is waiting", which the Home
       * copy must not confuse -- telling somebody to start with one person
       * after they just asked one is the app forgetting what they did. */
      admin
        .from("friend_requests")
        .select("id", { count: "exact", head: true })
        .eq("sender_id", userId)
        .eq("status", "pending"),
      // The viewer's own fix, from the same table the proximity service reads.
      admin.from("user_locations").select("last_updated").eq("user_id", userId).maybeSingle(),
      nearbyPromise,
      admin
        .from("plan_participants")
        .select("plan_id", { count: "exact", head: true })
        .eq("user_id", userId)
        .in("rsvp_status", ["going", "maybe", "invited"])
    ]);

  /* THE BUG THIS BLOCK CLOSES.
   *
   * `{ count } = await query` never throws on a Postgrest failure -- the
   * client resolves with `{ data: null, count: null, error }` -- so the old
   * code's `count ?? 0` turned a permission error, a dropped connection or a
   * misconfigured credential into the exact same zero a genuinely new account
   * produces. `resolveActivationState` cannot tell "this person has zero
   * Muddies" from "the read failed" unless something upstream checks `.error`
   * first, so this is that check. Only the query that feeds
   * `resolveActivationState`'s very first branch (muddyCount) and the one
   * `Plans` depends on are load-bearing enough to flip `status` -- a failure
   * on, say, the pending-request count degrades one nudge, not the whole
   * screen, so it is left to its existing soft `?? 0` default. */
  const projectionFailed = Boolean(muddyResult.error) || Boolean(planResult.error) || nearbyFailed;
  const muddyCount = muddyResult.count;
  const planCount = planResult.count;

  /* Location is judged by EVIDENCE, not by a stored intention.
   *
   * A "we asked for permission" flag goes stale the moment somebody revokes it
   * in system settings, and the app would then keep promising a Glow it cannot
   * deliver. A recent location fix is proof the grant is real right now.
   *
   * TWO QUESTIONS, NOT ONE. The same timestamp answers "is location set up"
   * and "can we say who is nearby", and they have different answers: setup
   * survives an afternoon indoors, a proximity claim does not. Both thresholds
   * belong to the proximity module, which owns what "current" means. */
  const nowMs = Date.now();
  const lastFixMs = viewerLocation?.last_updated ? Date.parse(viewerLocation.last_updated) : null;
  const locationGranted = hasLocationSetupEvidence(lastFixMs, nowMs);
  const locationFreshForProximity = isLocationFreshForProximity(lastFixMs, nowMs);

  const milestones = new Set((milestoneRows ?? []).map((row) => row.milestone));

  /* The first-Muddy moment, and who it was with.
   *
   * Both come from projections that already exist: the milestone's own
   * timestamp, and listMuddies' safe view (display name and avatar only -- no
   * new field was added for decoration). The Muddy is fetched ONLY while the
   * acknowledgement is actually live, so an ordinary Home load does not pay
   * for a query it will not use. */
  const firstMuddyReachedAt = (milestoneRows ?? []).find(
    (row) => row.milestone === "first_muddy_added"
  )?.reached_at;
  const firstMuddyReachedAtMs = firstMuddyReachedAt ? Date.parse(firstMuddyReachedAt) : NaN;

  const acknowledgeFirstMuddy = shouldAcknowledgeFirstMuddy({
    muddyCount: muddyCount ?? 0,
    firstMuddyReachedAtMs: Number.isFinite(firstMuddyReachedAtMs) ? firstMuddyReachedAtMs : null,
    nowMs: Date.now(),
    /* The completion half of the question (BETA-011).
     *
     * The card asks somebody to say hi, so it has to stop asking once they
     * have. `milestones` is the set already built above from the same rows
     * this function reads for everything else -- no extra query, no second
     * source of truth, and the answer is the account's rather than this
     * device's, so back-navigation, refresh, relogin and a second phone all
     * agree. */
    milestones
  });

  let firstMuddy: ActivationProjection["firstMuddy"] = null;
  if (acknowledgeFirstMuddy) {
    const { listMuddies } = await import("@/lib/friends/service");
    const { muddies } = await listMuddies(userId);
    const only = muddies[0];
    if (only) {
      firstMuddy = { id: only.id, displayName: only.displayName, avatarUrl: only.avatarUrl };
    }
  }

  /* WHO Home should talk about, loaded only when it will be shown.
   *
   * The relationship card renders in the quiet-evening state, so the lookup is
   * skipped entirely on every other Home. Paid for once, from projections that
   * already exist -- no new table, no migration, no per-Muddy round trip. */
  /* Also loaded when somebody IS nearby.
   *
   * The nearby hero needs the same contextual actions the quiet-evening card
   * uses -- who this person is to you decides whether the moment calls for a
   * hello, a wave or opening a plan. Restricting this to the empty case left
   * the payoff screen with no action at all. */
  const relationshipFocus =
    (muddyCount ?? 0) > 0 ? await loadRelationshipFocus(admin, userId) : null;

  /* MATURITY EVIDENCE, loaded whenever there is a Muddy at all -- OR whenever
   * the muddy count itself is the thing that failed to load.
   *
   * `(muddyCount ?? 0) > 0` alone re-creates the bug this file exists to fix:
   * a failed friendships query makes `muddyCount` null, `null ?? 0` is 0, and
   * an established account with real Plans and replied conversations would
   * skip the one lookup that could still have proven it. Attempting maturity
   * evidence whenever the count is unusable costs one extra pair of cheap
   * reads on a failure that should already be rare, and it is the difference
   * between "we don't know, so protect them" and "we don't know, so treat
   * them as new".
   *
   * Not folded into loadRelationshipFocus: that only runs on the quiet-evening
   * Home, and Home needs to know how experienced somebody is on every screen --
   * including the one where a Muddy is actually nearby. */
  const [maturity, unreadConversationCount] =
    (muddyCount ?? 0) > 0 || muddyResult.error
      ? await Promise.all([
          loadMaturityEvidence(admin, userId),
          /* The CANONICAL count (MB-GOD-052), not a second definition. It reads
           * the same conversation_previews RPC as the inbox and the badge, and
           * carries a documented `status = 'joined'` correction that a
           * hand-rolled query here would silently lose. Failing soft: an unread
           * lookup that errors must never take Home down with it -- the worst
           * case is the setup nudge the fix suppresses. */
          getUnreadMessageCount(userId).catch(() => 0)
        ])
      : [{ twoSidedConversationCount: 0, planParticipationCount: 0 }, 0];
  const inputs: ActivationInputs = {
    muddyCount: muddyCount ?? 0,
    pendingOutgoingCount: pendingOutgoingCount ?? 0,
    locationGranted,
    locationFreshForProximity,
    visibility: (profile?.visibility_status ?? "visible") as ActivationInputs["visibility"],
    nearbyMuddyCount: nearby.length,
    upcomingPlanCount: planCount ?? 0,
    milestones
  };

  return {
    /* "unavailable" when muddyCount, upcoming-plan count or nearby could not
     * be established. `state` below is still computed for diagnostic value
     * and for callers that only care about the ordinary path, but a caller
     * that respects `status` (Home's own page does) must not treat `state`
     * as a confirmed answer while this is "unavailable" -- see the big
     * comment on `status` above and on `EMPTY`. */
    status: projectionFailed ? "unavailable" : "ok",
    state: resolveActivationState(inputs),
    teachGlow: shouldTeachGlow(inputs),
    muddyCount: inputs.muddyCount,
    pendingOutgoingCount: inputs.pendingOutgoingCount,
    nearbyMuddyCount: inputs.nearbyMuddyCount,
    // The people themselves, so Home can render what the server already knows.
    nearby,
    upcomingPlanCount: inputs.upcomingPlanCount,
    locationGranted,
    locationFreshForProximity,
    milestones: [...milestones],
    acknowledgeFirstMuddy,
    firstMuddy,
    relationshipFocus,
    twoSidedConversationCount: maturity.twoSidedConversationCount,
    unreadConversationCount,
    planParticipationCount: maturity.planParticipationCount
  };
}
