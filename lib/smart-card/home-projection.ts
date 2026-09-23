import "server-only";

import { ACHIEVEMENT_BY_CODE } from "@/lib/achievements/achievement-catalog";
import { normalizePreferences } from "@/lib/notifications/preferences";
import { batchBlockedIds } from "@/lib/social/permissions";
import { resolveEventLinkrEligibility } from "@/lib/events/linkr-consent";
import { resolveActivationRequirements } from "@/lib/linkr/rules";
import { resolveAge } from "@/lib/linkr/profile-service";
import { hasProfilePicture } from "@/lib/linkr/media-projection";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSupabaseServerEnv } from "@/lib/supabase/env";
import { dateKeyInTimeZone } from "@/lib/profile/birth-date";
import { DEFAULT_RECIPIENT_TIMEZONE } from "@/lib/notifications/preferences";
import type {
  BlockedFeatureForCard,
  EventLinkrOfferForCard,
  MuddyBirthdayForCard,
  PlanChatDecisionForCard,
  PlanDecisionForCard,
  RecentAchievementForCard
} from "@/lib/smart-card/home-context";

type Admin = ReturnType<typeof createSupabaseAdminClient>;

const HOME_ACHIEVEMENT_RECENCY_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * ONE bounded Home projection for the Smart Card states added in families 3-5.
 *
 * WHY ONE MODULE RATHER THAN FIVE READERS. Each of these states needs a small,
 * specific fact that no existing Home projection already carries, and every one
 * of them is cheap only because it is BOUNDED by something Home has already
 * loaded -- the agenda's plan ids, the viewer's own check-ins, today's
 * delivered birthday notifications. Gathering them here keeps that bounding
 * visible in one place, and keeps the providers pure.
 *
 * WHAT THIS MODULE MAY NOT DO, and does not:
 *   - decide who is eligible for Event Linkr (lib/events/linkr-consent owns it)
 *   - decide what Linkr requires of a profile (lib/linkr/rules owns it)
 *   - decide whose birthday may be mentioned (the delivery ledger owns it)
 *   - read message text, or any conversation the viewer is not a member of
 *   - read anybody's date of birth
 *
 * Every helper fails CLOSED. A failed read yields the absent state, which
 * renders no card, rather than a card built from a half-answer.
 */

function serverReady(): boolean {
  const env = getSupabaseServerEnv();
  return Boolean(env.url && env.serviceRoleKey);
}

/**
 * The Event the viewer is checked in to and has not yet answered Event Linkr for.
 *
 * BOUNDED BY THE VIEWER'S OWN LIVE CHECK-INS, which is what keeps this cheap:
 * one query for "am I checked in anywhere", and only then does it ask the
 * Events authority about eligibility. Somebody who is not checked in anywhere
 * -- the overwhelming majority of Home renders -- pays exactly one query.
 *
 * THE ANSWER COMES FROM EVENTS, NOT FROM HERE. `resolveEventLinkrEligibility`
 * re-derives the event being live, the check-in still standing and the consent
 * decision; this function only asks it, and only surfaces the ONE reason that
 * means "eligible to be asked": `no_consent`. An already-consented viewer
 * (`eligible`) is not offered anything, because they have already decided.
 */
export async function loadEventLinkrOffer(
  admin: Admin,
  userId: string
): Promise<EventLinkrOfferForCard | null> {
  const { data: checkIns } = await admin
    .from("check_ins")
    .select("context_id")
    .eq("user_id", userId)
    .eq("context_type", "event")
    .eq("status", "checked_in")
    .order("checked_in_at", { ascending: false })
    .limit(3);

  const eventIds = [...new Set((checkIns ?? []).map((row) => row.context_id))];
  if (eventIds.length === 0) return null;

  /* BOUNDED AT THREE, AND IT RETURNS ON THE FIRST MATCH. This is a loop over
     the viewer's own live check-ins, capped by the query above, so its cost
     does not grow with the size of any table -- it is not an N+1. Being
     checked in to more than one Event at once is already unusual, and the
     ordinary case is a single pass. */
  for (const eventId of eventIds) {
    const eligibility = await resolveEventLinkrEligibility(admin, userId, eventId);
    /* ONLY the not-yet-asked case. `eligible` means they already consented, and
       every other reason means the offer would be untrue. */
    if (eligibility.reason !== "no_consent") continue;

    const { data: event } = await admin
      .from("events")
      .select("id, name, ends_at")
      .eq("id", eventId)
      .maybeSingle();
    const name = event?.name?.trim();
    if (!name) continue;

    if (!event?.ends_at) continue;
    return { eventId, eventName: name, endsAt: event.ends_at, href: `/events?event=${eventId}` };
  }

  return null;
}

/**
 * Muddy birthdays this viewer may act on RIGHT NOW.
 *
 * TWO DIFFERENT QUESTIONS, and conflating them was a real defect.
 *
 *   THE DELIVERY LEDGER answers "whose birthday is today, and was this viewer
 *   allowed to be told?" It is a historical record: the hourly job wrote the
 *   row only after establishing the owner's field privacy, their announcement
 *   preference, a live friendship and no block. That makes it the DATE
 *   authority, and it is why no date of birth is read on this path at all.
 *
 *   IT DOES NOT answer "is this viewer still allowed to act?" A block, an ended
 *   friendship or a privacy change AFTER delivery leaves the row standing, and
 *   Home would go on encouraging a birthday wish that `sendBirthdayWish` will
 *   refuse with "This birthday wish is no longer available." A card whose
 *   action is already doomed is worse than no card.
 *
 * So the ledger supplies the date and the candidate owners, and the four
 * revocable facts are re-read for those owners NOW -- privacy, announcement
 * preference, friendship, block -- exactly the conditions the birthday service
 * itself checks before sending. Still no date of birth.
 *
 * BATCHED, not per birthday: five queries for the whole set, whatever its size.
 * The historical row is never deleted -- it records what happened earlier.
 */
export async function loadMuddyBirthdays(
  admin: Admin,
  userId: string,
  now: Date
): Promise<MuddyBirthdayForCard[]> {
  const dayKey = dateKeyInTimeZone(now, DEFAULT_RECIPIENT_TIMEZONE);

  const { data: deliveries } = await admin
    .from("birthday_notification_deliveries")
    .select("birthday_user_id")
    .eq("recipient_id", userId)
    .eq("birthday_day", dayKey)
    .eq("status", "delivered")
    .limit(10);

  const ownerIds = [...new Set((deliveries ?? []).map((row) => row.birthday_user_id))].filter(
    (id) => id !== userId
  );
  if (ownerIds.length === 0) return [];

  const [{ data: profiles }, { data: privacyRows }, { data: preferenceRows }, { data: friendships }, blocked] =
    await Promise.all([
      admin
        .from("profiles")
        .select("user_id, full_name, username, visibility_status, deleted_at")
        .in("user_id", ownerIds),
      /* Birthday field privacy, as the birthday service requires it: the owner
         must still be sharing with approved Muddies. */
      admin
        .from("profile_field_privacy")
        .select("user_id, visibility")
        .eq("field_name", "birthday")
        .in("user_id", ownerIds),
      admin
        .from("user_preferences")
        .select("user_id, notification_preferences")
        .in("user_id", ownerIds),
      /* The friendship must still be live. An ended one removes the card even
         though the notification legitimately went out this morning. */
      admin
        .from("friendships")
        .select("user_one_id, user_two_id")
        .or(`user_one_id.eq.${userId},user_two_id.eq.${userId}`)
        .is("ended_at", null),
      batchBlockedIds(admin, userId, ownerIds)
    ]);

  const sharing = new Set(
    (privacyRows ?? [])
      .filter((row) => row.visibility === "approved_muddies")
      .map((row) => row.user_id)
  );
  const announcing = new Set(
    (preferenceRows ?? [])
      .filter((row) => normalizePreferences(row.notification_preferences).birthdayAnnouncementsEnabled)
      .map((row) => row.user_id)
  );
  const friends = new Set(
    (friendships ?? []).map((row) => (row.user_one_id === userId ? row.user_two_id : row.user_one_id))
  );

  const birthdays: MuddyBirthdayForCard[] = [];
  for (const profile of profiles ?? []) {
    const ownerId = profile.user_id;
    if (profile.deleted_at || profile.visibility_status === "ghost") continue;
    if (!friends.has(ownerId)) continue;
    if (blocked.has(ownerId)) continue;
    if (!sharing.has(ownerId)) continue;
    if (!announcing.has(ownerId)) continue;
    birthdays.push({
      userId: ownerId,
      displayName: profile.full_name?.trim() || profile.username || "A Muddy"
    });
  }
  return birthdays;
}

/**
 * Open Plan decisions still waiting on this viewer's vote.
 *
 * BOUNDED BY THE AGENDA. `planIds` are the Plans Home has ALREADY loaded and
 * already permission-filtered, so this asks about at most a handful of Plans
 * the viewer demonstrably belongs to. It never discovers Plans of its own, and
 * therefore cannot reach one the viewer cannot see.
 *
 * ELIGIBILITY MATCHES THE VOTE ACTION EXACTLY: status `open`, not past
 * `closes_at`, and no existing vote from this viewer. "The Plan is polling" and
 * "a poll exists" are both insufficient -- somebody who has already voted is
 * owed nothing, and asking them again would be the card lying about who is
 * blocking the decision.
 */
export async function loadPlanDecisions(
  admin: Admin,
  userId: string,
  planIds: readonly string[],
  planTitleById: ReadonlyMap<string, string>,
  planEndById: ReadonlyMap<string, string>,
  now: Date
): Promise<PlanDecisionForCard[]> {
  if (planIds.length === 0) return [];

  const { data: polls } = await admin
    .from("plan_polls")
    .select("id, plan_id, question, status, closes_at, created_at")
    .in("plan_id", [...planIds])
    .eq("status", "open");

  const planRank = new Map(planIds.map((planId, index) => [planId, index]));
  const open = (polls ?? [])
    .filter((poll) => !poll.closes_at || Date.parse(poll.closes_at) > now.getTime())
    .sort((a, b) => {
      /*
       * The agenda is already chronological. A decision on the sooner Plan
       * should therefore win Home before a decision on a later Plan. If one
       * Plan somehow has several open polls, newest first is deterministic and
       * matches the Plan Chat rule.
       */
      const planDelta = (planRank.get(a.plan_id) ?? Number.MAX_SAFE_INTEGER) -
        (planRank.get(b.plan_id) ?? Number.MAX_SAFE_INTEGER);
      if (planDelta !== 0) return planDelta;
      return Date.parse(b.created_at) - Date.parse(a.created_at);
    });
  if (open.length === 0) return [];

  const pollIds = open.map((poll) => poll.id);
  /* One query for every vote on every candidate poll: the viewer's own votes
     tell us which polls to drop, and the rest give the honest progress count
     without naming who chose what. */
  const { data: votes } = await admin
    .from("plan_poll_votes")
    .select("poll_id, user_id")
    .in("poll_id", pollIds);

  const votedByViewer = new Set<string>();
  const votersByPoll = new Map<string, Set<string>>();
  for (const vote of votes ?? []) {
    if (vote.user_id === userId) votedByViewer.add(vote.poll_id);
    if (!votersByPoll.has(vote.poll_id)) votersByPoll.set(vote.poll_id, new Set());
    votersByPoll.get(vote.poll_id)!.add(vote.user_id);
  }

  const decisions: PlanDecisionForCard[] = [];
  for (const poll of open) {
    if (votedByViewer.has(poll.id)) continue;
    const planTitle = planTitleById.get(poll.plan_id);
    const planEndsAt = planEndById.get(poll.plan_id);
    if (!planTitle || !planEndsAt) continue;
    decisions.push({
      planId: poll.plan_id,
      planTitle,
      question: poll.question,
      voterCount: votersByPoll.get(poll.id)?.size ?? 0,
      closesAt: poll.closes_at,
      planEndsAt
    });
  }
  return decisions;
}

/**
 * Open polls inside Plan Chats the viewer belongs to and has not answered.
 *
 * A STRUCTURED DECISION, NEVER MESSAGE TEXT. The only thing read from a
 * conversation is a poll somebody deliberately created in it -- its question
 * and its votes. No message body, no preview and no unread count is read here,
 * so this cannot degrade into "3 unread messages" wearing different words.
 *
 * MEMBERSHIP FIRST, ALWAYS. The candidate set starts from the viewer's own
 * JOINED `conversation_members` rows, so a poll in a conversation they are not
 * in is never fetched -- not filtered out afterwards, never fetched.
 */
export async function loadPlanChatDecisions(
  admin: Admin,
  userId: string,
  planTitleById: ReadonlyMap<string, string>,
  planEndById: ReadonlyMap<string, string>,
  now: Date
): Promise<PlanChatDecisionForCard[]> {
  /*
   * A Plan Chat decision is a CURRENT coordination job, not a historical poll.
   * If Home has no current Plan in its canonical agenda, there is nothing this
   * reader is allowed to turn into a Smart Card.
   */
  if (planTitleById.size === 0) return [];

  const currentPlanIds = [...planTitleById.keys()];

  const { data: memberships } = await admin
    .from("conversation_members")
    .select("conversation_id")
    .eq("user_id", userId)
    .eq("status", "joined")
    .limit(200);

  const conversationIds = (memberships ?? []).map((row) => row.conversation_id);
  if (conversationIds.length === 0) return [];

  /* Plan Chats only. `context_type` is the STORED authority for what a
     conversation belongs to, so this never guesses from a title. */
  const { data: conversations } = await admin
    .from("conversations")
    .select("id, context_id")
    .in("id", conversationIds)
    .eq("context_type", "plan")
    /*
     * CLOSED PLAN CHATS ARE READABLE BUT NOT ACTIONABLE. Messaging archives a
     * Plan Chat when its lifecycle closes; accepting every status except
     * "deleted" made an archived, non-writable chat look like live
     * coordination on Home.
     */
    .eq("status", "active")
    /*
     * Bound Plan Chat decisions to the same current agenda Home already uses
     * for Plan RSVP/start/poll cards. This also fails closed if the closure job
     * is late and a past Plan's conversation is still marked active.
     */
    .in("context_id", currentPlanIds);

  const planChatIds = (conversations ?? []).map((row) => row.id);
  if (planChatIds.length === 0) return [];

  const { data: polls } = await admin
    .from("chat_polls")
    .select("message_id, conversation_id, question, closed_at, created_at")
    .in("conversation_id", planChatIds)
    .is("closed_at", null)
    /* Newest candidates first before the bounded parent-message validation.
       Without this, database row order could let old tombstones occupy the
       whole limit and hide a current poll. */
    .order("created_at", { ascending: false })
    .limit(20);

  const candidatePolls = polls ?? [];
  if (candidatePolls.length === 0) return [];

  /*
   * IMPORTANT: this reader uses service_role, so chat_polls RLS cannot protect
   * us from a deleted or expired parent message. A poll message may be
   * tombstoned (delete-for-everyone) or may have expired while its structured
   * poll row still exists. Home must apply the same "parent is live" rule the
   * chat UI applies before a poll can become a Smart Card.
   *
   * Kept messages remain live after their original expires_at, matching the
   * canonical retention rule.
   */
  const { data: parentMessages } = await admin
    .from("messages")
    .select("id, status, deleted_at, expires_at, kept_at")
    .in(
      "id",
      candidatePolls.map((poll) => poll.message_id)
    );

  const nowMs = now.getTime();
  const liveParentIds = new Set(
    (parentMessages ?? [])
      .filter((message) => {
        if (message.deleted_at || message.status === "deleted") return false;
        if (message.kept_at || !message.expires_at) return true;
        const expiresAt = Date.parse(message.expires_at);
        return Number.isFinite(expiresAt) && expiresAt > nowMs;
      })
      .map((message) => message.id)
  );

  const planIdByConversation = new Map(
    (conversations ?? []).map((row) => [row.id, row.context_id])
  );
  const planRank = new Map(currentPlanIds.map((planId, index) => [planId, index]));

  const openPolls = candidatePolls
    .filter((poll) => liveParentIds.has(poll.message_id))
    .sort((a, b) => {
      const aPlan = planIdByConversation.get(a.conversation_id);
      const bPlan = planIdByConversation.get(b.conversation_id);
      const planDelta =
        (aPlan ? planRank.get(aPlan) ?? Number.MAX_SAFE_INTEGER : Number.MAX_SAFE_INTEGER) -
        (bPlan ? planRank.get(bPlan) ?? Number.MAX_SAFE_INTEGER : Number.MAX_SAFE_INTEGER);
      if (planDelta !== 0) return planDelta;
      return Date.parse(b.created_at) - Date.parse(a.created_at);
    });
  if (openPolls.length === 0) return [];

  const { data: votes } = await admin
    .from("chat_poll_votes")
    .select("poll_message_id")
    .eq("user_id", userId)
    .in(
      "poll_message_id",
      openPolls.map((poll) => poll.message_id)
    );
  const answered = new Set((votes ?? []).map((row) => row.poll_message_id));

  const decisions: PlanChatDecisionForCard[] = [];
  for (const poll of openPolls) {
    if (answered.has(poll.message_id)) continue;
    const planId = planIdByConversation.get(poll.conversation_id);
    const planTitle = planId ? planTitleById.get(planId) : undefined;
    const planEndsAt = planId ? planEndById.get(planId) : undefined;
    // Current agenda membership and a hard lifecycle boundary are mandatory.
    if (!planId || !planTitle || !planEndsAt) continue;
    decisions.push({
      conversationId: poll.conversation_id,
      planTitle,
      question: poll.question,
      planEndsAt
    });
  }
  return decisions;
}

/**
 * The newest achievement earned recently enough to still be a Home moment.
 *
 * We deliberately do NOT surface a user's all-time newest badge with no time
 * bound: shipping this provider to an established account must not resurrect a
 * months-old achievement as though it just happened. Seven days is a generous
 * catch-up window for somebody who has not opened Home for a few days, while
 * still keeping the heartbeat about current life.
 *
 * The canonical in-app achievement catalog supplies the display name; an
 * unknown code fails closed instead of inventing presentation copy.
 */
export async function loadRecentAchievement(
  admin: Admin,
  userId: string,
  now: Date
): Promise<RecentAchievementForCard | null> {
  const cutoff = new Date(now.getTime() - HOME_ACHIEVEMENT_RECENCY_MS).toISOString();
  const { data: row } = await admin
    .from("user_achievements")
    .select("achievement_code, earned_at")
    .eq("user_id", userId)
    .gte("earned_at", cutoff)
    .order("earned_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!row) return null;
  const definition = ACHIEVEMENT_BY_CODE.get(row.achievement_code);
  if (!definition) return null;

  return {
    code: row.achievement_code,
    title: definition.name,
    earnedAt: row.earned_at,
    expiresAt: new Date(Date.parse(row.earned_at) + HOME_ACHIEVEMENT_RECENCY_MS).toISOString()
  };
}

/**
 * A feature the viewer switched ON that their profile currently blocks.
 *
 * NOT PROFILE COMPLETION, and the difference is the whole state. This asks one
 * question about one feature: has this person made an explicit, durable
 * decision to enable Linkr, and does Linkr's own rule then refuse to show them?
 * If they never turned it on, nothing is blocked and nothing is said -- an
 * empty profile is only a problem for a door somebody actually tried to open.
 *
 * The outstanding requirement is Linkr's own sentence, from
 * `resolveActivationRequirements`, so Home cannot grow a second opinion about
 * what Linkr requires. Underage is deliberately not surfaced: it is an answer
 * the person cannot act on, and a card asking them to finish something they
 * cannot finish would be worse than silence.
 */
export async function loadBlockedFeature(
  admin: Admin,
  userId: string
): Promise<BlockedFeatureForCard | null> {
  const { data: linkr } = await admin
    .from("linkr_profiles")
    .select("enabled")
    .eq("user_id", userId)
    .maybeSingle();
  /* No row, or switched off, means nothing was opened and nothing is blocked. */
  if (!linkr?.enabled) return null;

  /* The same two canonical helpers Linkr's own discovery uses for the viewer's
     side of reciprocity -- `resolveAge` and `hasProfilePicture` -- so Home's
     answer to "can this person be shown" cannot disagree with Linkr's. */
  const [age, hasPrimaryPhoto] = await Promise.all([
    resolveAge(admin, userId),
    hasProfilePicture(admin, userId)
  ]);

  const requirements = resolveActivationRequirements({ age, hasPrimaryPhoto });
  if (requirements.canActivate || requirements.underage) return null;
  if (!requirements.profileMessage) return null;

  return {
    feature: "Linkr",
    requirement: requirements.profileMessage,
    href: "/profile"
  };
}

export type HomeSmartCardProjection = {
  eventLinkrOffer: EventLinkrOfferForCard | null;
  muddyBirthdays: MuddyBirthdayForCard[];
  planDecisions: PlanDecisionForCard[];
  planChatDecisions: PlanChatDecisionForCard[];
  blockedFeature: BlockedFeatureForCard | null;
  recentAchievement: RecentAchievementForCard | null;
};

const EMPTY: HomeSmartCardProjection = {
  eventLinkrOffer: null,
  muddyBirthdays: [],
  planDecisions: [],
  planChatDecisions: [],
  blockedFeature: null,
  recentAchievement: null
};

/**
 * Everything the newer Smart Card states need, in ONE parallel batch.
 *
 * Takes the Plans Home has already loaded rather than finding its own, so the
 * decision readers stay bounded by an agenda that is already permission
 * filtered. Failing closed is deliberate and total: if this whole projection
 * throws, Home still renders its Smart Card from the states it already had.
 */
export async function loadHomeSmartCardProjection(input: {
  userId: string;
  planIds: readonly string[];
  planTitleById: ReadonlyMap<string, string>;
  planEndById: ReadonlyMap<string, string>;
  now: Date;
}): Promise<HomeSmartCardProjection> {
  if (!serverReady()) return EMPTY;
  const admin = createSupabaseAdminClient();

  try {
    const [
      eventLinkrOffer,
      muddyBirthdays,
      planDecisions,
      planChatDecisions,
      blockedFeature,
      recentAchievement
    ] = await Promise.all([
      loadEventLinkrOffer(admin, input.userId),
      loadMuddyBirthdays(admin, input.userId, input.now),
      loadPlanDecisions(
        admin,
        input.userId,
        input.planIds,
        input.planTitleById,
        input.planEndById,
        input.now
      ),
      loadPlanChatDecisions(
        admin,
        input.userId,
        input.planTitleById,
        input.planEndById,
        input.now
      ),
      loadBlockedFeature(admin, input.userId),
      loadRecentAchievement(admin, input.userId, input.now)
    ]);

    return {
      eventLinkrOffer,
      muddyBirthdays,
      planDecisions,
      planChatDecisions,
      blockedFeature,
      recentAchievement
    };
  } catch {
    return EMPTY;
  }
}
