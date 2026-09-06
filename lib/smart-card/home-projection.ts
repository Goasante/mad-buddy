import "server-only";

import { hasEverHadWelcomeAccess } from "@/lib/access/guard";
import { resolveAccessForUser } from "@/lib/access/resolver";
import { resolveEventLinkrEligibility } from "@/lib/events/linkr-consent";
import { resolveActivationRequirements } from "@/lib/linkr/rules";
import { resolveAge } from "@/lib/linkr/profile-service";
import { hasProfilePicture } from "@/lib/linkr/media-projection";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSupabaseServerEnv } from "@/lib/supabase/env";
import { dateKeyInTimeZone } from "@/lib/profile/birth-date";
import { DEFAULT_RECIPIENT_TIMEZONE } from "@/lib/notifications/preferences";
import type {
  AccessForCard,
  BlockedFeatureForCard,
  EventLinkrOfferForCard,
  MuddyBirthdayForCard,
  PlanChatDecisionForCard,
  PlanDecisionForCard
} from "@/lib/smart-card/home-context";

type Admin = ReturnType<typeof createSupabaseAdminClient>;

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
      .select("id, name")
      .eq("id", eventId)
      .maybeSingle();
    const name = event?.name?.trim();
    if (!name) continue;

    return { eventId, eventName: name, href: `/events?event=${eventId}` };
  }

  return null;
}

/**
 * Muddy birthdays this viewer has ALREADY been told about today.
 *
 * READS THE DELIVERY LEDGER, NOT ANYBODY'S DATE OF BIRTH. The hourly birthday
 * job writes a row here only after it has established, for this exact pair,
 * that the owner's birthday field privacy is `approved_muddies`, their
 * announcement preference is on, a live friendship exists and neither has
 * blocked the other. A `delivered` row is therefore a decision the product has
 * already made and already acted on -- Home repeats it rather than re-deriving
 * it, and no date of birth is read on this path at all.
 *
 * `suppressed` rows are excluded deliberately: those are people the delivery
 * layer decided NOT to tell, and Home telling them anyway would overturn that.
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

  const ownerIds = [...new Set((deliveries ?? []).map((row) => row.birthday_user_id))];
  if (ownerIds.length === 0) return [];

  /* Names only, and only for people the ledger already cleared. A deleted or
     hidden account drops out rather than appearing as a ghost. */
  const { data: profiles } = await admin
    .from("profiles")
    .select("user_id, full_name, username, visibility_status, deleted_at")
    .in("user_id", ownerIds);

  const birthdays: MuddyBirthdayForCard[] = [];
  for (const profile of profiles ?? []) {
    if (profile.deleted_at || profile.visibility_status === "ghost") continue;
    birthdays.push({
      userId: profile.user_id,
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
  now: Date
): Promise<PlanDecisionForCard[]> {
  if (planIds.length === 0) return [];

  const { data: polls } = await admin
    .from("plan_polls")
    .select("id, plan_id, question, status, closes_at")
    .in("plan_id", [...planIds])
    .eq("status", "open");

  const open = (polls ?? []).filter(
    (poll) => !poll.closes_at || Date.parse(poll.closes_at) > now.getTime()
  );
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
    if (!planTitle) continue;
    decisions.push({
      planId: poll.plan_id,
      planTitle,
      question: poll.question,
      voterCount: votersByPoll.get(poll.id)?.size ?? 0
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
  planTitleById: ReadonlyMap<string, string>
): Promise<PlanChatDecisionForCard[]> {
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
    .neq("status", "deleted");

  const planChatIds = (conversations ?? []).map((row) => row.id);
  if (planChatIds.length === 0) return [];

  const { data: polls } = await admin
    .from("chat_polls")
    .select("message_id, conversation_id, question, closed_at")
    .in("conversation_id", planChatIds)
    .is("closed_at", null)
    .limit(20);

  const openPolls = polls ?? [];
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

  const planIdByConversation = new Map(
    (conversations ?? []).map((row) => [row.id, row.context_id])
  );

  const decisions: PlanChatDecisionForCard[] = [];
  for (const poll of openPolls) {
    if (answered.has(poll.message_id)) continue;
    const planId = planIdByConversation.get(poll.conversation_id);
    decisions.push({
      conversationId: poll.conversation_id,
      planTitle: planId ? planTitleById.get(planId) ?? null : null,
      question: poll.question
    });
  }
  return decisions;
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

/**
 * What Access permits, reduced to Home's one question.
 *
 * Reads the SAME `resolveAccessForUser` every gated Linkr and UpFor mutation
 * resolves through, so Home cannot offer an expansion the server would then
 * refuse -- and cannot withhold one the server would allow.
 *
 * FAILS OPEN, which is the opposite of the guard and deliberately so. The guard
 * protects a mutation, where the safe answer to "I do not know" is no. This
 * only decides what Home SAYS, where the safe answer is to keep the person's
 * existing social life visible: a failed entitlement read must never blank
 * somebody's Muddies, Plans or conversations.
 */
export async function loadAccessForCard(userId: string): Promise<AccessForCard> {
  try {
    const [access, hadWelcome] = await Promise.all([
      resolveAccessForUser(userId),
      hasEverHadWelcomeAccess(userId)
    ]);
    return { canExpand: access.hasAccess, hadWelcomeAccess: hadWelcome };
  } catch {
    return { canExpand: true, hadWelcomeAccess: false };
  }
}

export type HomeSmartCardProjection = {
  eventLinkrOffer: EventLinkrOfferForCard | null;
  muddyBirthdays: MuddyBirthdayForCard[];
  planDecisions: PlanDecisionForCard[];
  planChatDecisions: PlanChatDecisionForCard[];
  blockedFeature: BlockedFeatureForCard | null;
  access: AccessForCard;
};

const EMPTY: HomeSmartCardProjection = {
  eventLinkrOffer: null,
  muddyBirthdays: [],
  planDecisions: [],
  planChatDecisions: [],
  blockedFeature: null,
  /* Ungated: an absent projection must not withhold anybody's existing life. */
  access: { canExpand: true, hadWelcomeAccess: false }
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
  now: Date;
}): Promise<HomeSmartCardProjection> {
  if (!serverReady()) return EMPTY;
  const admin = createSupabaseAdminClient();

  try {
    const [eventLinkrOffer, muddyBirthdays, planDecisions, planChatDecisions, blockedFeature, access] =
      await Promise.all([
        loadEventLinkrOffer(admin, input.userId),
        loadMuddyBirthdays(admin, input.userId, input.now),
        loadPlanDecisions(admin, input.userId, input.planIds, input.planTitleById, input.now),
        loadPlanChatDecisions(admin, input.userId, input.planTitleById),
        loadBlockedFeature(admin, input.userId),
        loadAccessForCard(input.userId)
      ]);

    return {
      eventLinkrOffer,
      muddyBirthdays,
      planDecisions,
      planChatDecisions,
      blockedFeature,
      access
    };
  } catch {
    return EMPTY;
  }
}
