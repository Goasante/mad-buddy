import { availableSmartCard } from "@/lib/smart-card/availability";

import { type FeatureAvailability } from "@/lib/features/availability";
/**
 * Pure Smart Card providers.
 *
 * Every provider is a deterministic function of SmartCardInput. No queries,
 * no randomness and no hidden ranking model live here. Home loads canonical
 * facts once, then the engine chooses the first truthful applicable state.
 */

import { gracePeriodEndMs } from "@/lib/safety/safe-arrival";
import type { HomeUpForContext } from "@/lib/social/home-upfor-context";
import type { LinkrMutualForCard } from "@/lib/smart-card/linkr-context";
import { isPlanDecisionRsvpEligible } from "@/lib/smart-card/home-context";
import type {
  BlockedFeatureForCard,
  EventLinkrOfferForCard,
  MuddyBirthdayForCard,
  PlanChatDecisionForCard,
  PlanDecisionForCard,
  RecentAchievementForCard
} from "@/lib/smart-card/home-context";
import { conversationHref } from "@/lib/messaging/open-conversation";
import { upForActivitySmartCardMedia } from "@/lib/smart-card/visuals";
import { MAX_ACTIVE_UPFORS } from "@/lib/social/upfor-limits";
import type { BuddyScoreData } from "@/lib/engagement/buddy-score-service";
import type { JourneyData } from "@/lib/journey/journey";
import type { UpcomingAgendaItem } from "@/lib/social/upcoming-agenda-projection";
import type { MeetupHomeItem } from "@/lib/meetups/rules";
import {
  isWeekendPlanningWindow,
  smartCardProgress,
  weekendWindowExpiry,
  type SmartCard,
  type SmartCardProvider
} from "@/lib/smart-card/smart-card";

export type SmartCardNearbyFriend = {
  friend_id: string;
  display_name: string;
  username: string;
  avatar_url: string | null;
  proximity_band:
    | "right_here"
    | "around_you"
    | "close_by"
    | "nearby"
    | "around_town"
    | "further_away"
    | "outside_range";
  freshness_state: "live" | "recent" | "older" | "stale";
};

export type SmartCardInput = {
  now: Date;
  availability?: FeatureAvailability;
  journey: JourneyData | null;
  safeArrival:
    | {
        travelling: boolean;
        watcherCount: number;
        destinationLabel?: string | null;
        expectedArrivalAt?: string | null;
        gracePeriodMinutes?: number | null;
        status?: string | null;
      }
    | null;
  birthday: { birthdayToday: boolean; birthdayTomorrow: boolean } | null;
  /** Canonical Home agenda — Events only after Plans retirement. */
  agenda: readonly UpcomingAgendaItem[];
  /** Materialized Meetups already accepted by the viewer. */
  meetups?: readonly MeetupHomeItem[];
  /**
   * UpFor facts from the one batched Home read (lib/social/home-upfor-context).
   * Optional so every existing caller and test keeps compiling; absent means
   * "no UpFor context", which yields no UpFor card rather than a wrong one.
   */
  upFor?: HomeUpForContext | null;
  /**
   * Muddy requests waiting on the viewer. Home already counts these for its
   * header badge, so this is a fact it owns rather than a new read.
   */
  incomingRequestCount?: number;
  /**
   * Linkr mutual connections, newest first, from loadClickedPeople.
   *
   * Only MUTUAL matches appear here -- Linkr's privacy model means a one-sided
   * interest is never surfaced -- and `hasConversation` is what separates a
   * genuine "say hi" from a pair who are already talking.
   */
  linkrMutuals?: readonly LinkrMutualForCard[];
  /**
   * An Event the viewer is CHECKED IN to and has not yet answered Event Linkr
   * for. Resolved server-side by the Events authority; absent means there is no
   * honest offer to make, which is the correct fail-closed default.
   */
  eventLinkrOffer?: EventLinkrOfferForCard | null;
  /**
   * Muddy birthdays the viewer has ALREADY been notified about today.
   *
   * Comes from the birthday delivery ledger, never from anybody's date of
   * birth. Absent means no privacy-permitted birthday to mention.
   */
  muddyBirthdays?: readonly MuddyBirthdayForCard[];
  /**
   * Plans the viewer is on that have an OPEN decision still awaiting their
   * vote, and Plan Chats holding an open poll they have not answered.
   */
  planDecisions?: readonly PlanDecisionForCard[];
  planChatDecisions?: readonly PlanChatDecisionForCard[];
  /**
   * A feature the viewer switched ON that their profile currently blocks them
   * from using. Absent means nothing is blocked.
   */
  blockedFeature?: BlockedFeatureForCard | null;
  /** Count of plans starting inside the current weekend window. */
  weekendPlanCount: number;
  /** Privacy-safe server projection; never coordinates or numerical distance. */
  nearbyFriends: readonly SmartCardNearbyFriend[];
  locationFreshForProximity: boolean;
  muddyCount: number;
  buddyScore: Pick<BuddyScoreData, "nextLevel" | "pointsToNext" | "progressPercent"> | null;
  recentAchievement: RecentAchievementForCard | null;
  suggestionCount: number;
};

const THREE_HOURS_MS = 3 * 60 * 60 * 1000;
/*
 * A mutual connection is a heartbeat MOMENT, not an evergreen reminder to
 * message somebody. Seven days gives someone who does not open Home daily a
 * fair chance to see it, while stopping a months-old silent match from
 * outranking today's birthday or other current relationship context.
 */
const LINKR_MUTUAL_RECENCY_MS = 7 * 24 * 60 * 60 * 1000;

function minutesUntil(iso: string, now: Date): number | null {
  const ms = Date.parse(iso) - now.getTime();
  if (!Number.isFinite(ms)) return null;
  return Math.max(0, Math.round(ms / 60_000));
}

function soonLabel(minutes: number): string {
  if (minutes < 60) return `Starts in ${Math.max(1, minutes)} min`;
  const hours = Math.max(1, Math.round(minutes / 60));
  return `Starts in ${hours} ${hours === 1 ? "hour" : "hours"}`;
}

function expiresAt(iso: string | null | undefined): number | undefined {
  if (!iso) return undefined;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : undefined;
}

function earliestExpiry(values: readonly (string | null | undefined)[]): number | undefined {
  const times = values
    .map((value) => expiresAt(value))
    .filter((value): value is number => value !== undefined);
  return times.length > 0 ? Math.min(...times) : undefined;
}

/**
 * Relative clock copy that is timezone-independent.
 *
 * Home does not currently carry the viewer's timezone into Smart Card
 * selection, so "tomorrow" can be wrong around midnight. Durations are honest
 * everywhere and still give the heartbeat the useful sense of when.
 */
function relativeInLabel(iso: string | null | undefined, now: Date): string | null {
  if (!iso) return null;
  const delta = Date.parse(iso) - now.getTime();
  if (!Number.isFinite(delta) || delta <= 0) return null;
  const minutes = Math.max(1, Math.ceil(delta / 60_000));
  if (minutes < 60) return `in ${minutes} min`;
  const hours = Math.max(1, Math.ceil(minutes / 60));
  if (hours < 24) return `in ${hours} ${hours === 1 ? "hour" : "hours"}`;
  const days = Math.max(1, Math.ceil(hours / 24));
  return `in ${days} ${days === 1 ? "day" : "days"}`;
}

function startsInLabel(iso: string | null | undefined, now: Date): string | null {
  const relative = relativeInLabel(iso, now);
  return relative ? `Starts ${relative}` : null;
}

function endOfLocalDayMs(now: Date): number {
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);
  return end.getTime();
}

/**
 * The canonical destination for ONE Linkr pair.
 *
 * Deliberately late-bound: `/linkr?connection=<id>` re-resolves at open time
 * through resolveMutualDestination, which re-checks that the viewer belongs to
 * the connection, honours a block or ending that happened since Home rendered,
 * and opens an already-running conversation rather than a stale "Say hi".
 * Home names the pair; the route decides what to do about them.
 *
 * One spelling, used by both mutual states, so the two cannot drift.
 */
function linkrPairDestination(connectionId: string): string {
  return `/linkr?connection=${encodeURIComponent(connectionId)}`;
}

/**
 * The canonical destination for ONE UpFor session.
 *
 * `?hangout=<id>` is what the UpFor page already understands: it scrolls that
 * session to the centre of the list. That is less than opening a detail sheet,
 * and it is deliberately not being redesigned here -- but a card that names one
 * UpFor should still bring the person to THAT one rather than to the top of a
 * list they then have to search.
 *
 * `upfor_requests` deliberately does NOT use this: it summarises requests across
 * every UpFor the viewer owns, so there is no single session to point at, and
 * pretending otherwise would pick one arbitrarily.
 */
/**
 * "You're studying together." -- momentum, not system status.
 *
 * Generated only for the activities where the natural English is a plain
 * present participle. Anything else keeps the safe existing sentence rather
 * than risking a phrase like "You're anything together": the important fix in
 * this card is the next ACTION, and brittle copy generation would be a poor
 * trade for it.
 */
const TOGETHER_LINE: Record<string, string> = {
  Study: "You're studying together.",
  Coffee: "You're getting coffee together.",
  Gym: "You're heading to the gym together.",
  Food: "You're eating together.",
  Walk: "You're going for a walk together.",
  Movie: "You're watching a movie together.",
  Drinks: "You're getting drinks together."
};

function acceptedTogetherLine(activityLabel: string): string {
  return TOGETHER_LINE[activityLabel] ?? "You are going to " + activityLabel.toLowerCase() + ".";
}

function upForSessionDestination(sessionId: string): string {
  return `/hangout-mode?hangout=${encodeURIComponent(sessionId)}`;
}

function currentLinkrMutuals(input: SmartCardInput): readonly LinkrMutualForCard[] {
  const nowMs = input.now.getTime();
  return (input.linkrMutuals ?? []).filter((person) => {
    if (person.hasConversation) return false;
    const connectedAt = Date.parse(person.connectedAt);
    if (!Number.isFinite(connectedAt)) return false;
    const age = nowMs - connectedAt;
    return age >= 0 && age < LINKR_MUTUAL_RECENCY_MS;
  });
}

function linkrMutualExpiry(person: LinkrMutualForCard): number | undefined {
  const connectedAt = Date.parse(person.connectedAt);
  return Number.isFinite(connectedAt) ? connectedAt + LINKR_MUTUAL_RECENCY_MS : undefined;
}

function proximityLabel(band: SmartCardNearbyFriend["proximity_band"]): string | null {
  switch (band) {
    case "right_here":
      return "Right Here";
    case "around_you":
      return "Just Around";
    case "close_by":
      return "Close By";
    case "nearby":
      return "In Your Area";
    case "around_town":
      return "Around Town";
    case "further_away":
      return "Across Town";
    case "outside_range":
      return null;
  }
}

/** Tier 0: a live Safe Arrival remains the absolute Home override. */

/** Tier 1: a Plan invitation is a real person waiting for an answer. */

/** Tier 2: a Plan the viewer is already part of is close enough to matter now. */

/** Tier 2: a relevant Event that is actually live, not merely discoverable. */
function eventLiveProvider(input: SmartCardInput): SmartCard | null {
  const event = input.agenda.find((item) => {
    if (item.kind !== "event") return false;
    /* "Interested" is consideration, not attendance. The starting-soon
       providers already preserve that distinction; live Events must not undo
       it by promoting a bookmark to HAPPENING NOW once the clock crosses
       starts_at. */
    if (!item.isHost && item.myRsvp !== "going") return false;
    const start = Date.parse(item.startsAt);
    const end = Date.parse(item.endsAt);
    const now = input.now.getTime();
    return Number.isFinite(start) && Number.isFinite(end) && start <= now && end > now;
  });
  if (!event || event.kind !== "event") return null;

  return {
    id: "event_live",
    priority: 0,
    illustration: "calendar",
    eyebrow: "HAPPENING NOW",
    title: `${event.title} is happening now`,
    subtitle: event.isHost ? "You're hosting. Open the Event to see what's happening." : "You're connected to this Event right now.",
    meta: event.locationLabel ?? undefined,
    metaKind: event.locationLabel ? "location" : undefined,
    socialProof: event.isHost ? undefined : `Hosted by ${event.hostName}`,
    media: event.coverUrl ? { url: event.coverUrl, alt: `${event.title} cover`, focalX: event.coverFocalX, focalY: event.coverFocalY } : undefined,
    cta: "View Event",
    destination: event.href,
    expiresAt: expiresAt(event.endsAt)
  };
}

/** Tier 2: fresh server-proven proximity only. Stale state can never win Home. */
function nearbyMuddiesProvider(input: SmartCardInput): SmartCard | null {
  if (!input.locationFreshForProximity) return null;
  const fresh = input.nearbyFriends.filter(
    (friend) => (friend.freshness_state === "live" || friend.freshness_state === "recent") && proximityLabel(friend.proximity_band)
  );
  if (fresh.length === 0) return null;

  const first = fresh[0];
  const label = proximityLabel(first.proximity_band) ?? "Nearby";
  const many = fresh.length > 1;
  return {
    id: "nearby_muddies",
    priority: 0,
    illustration: "people",
    eyebrow: many ? "MUDDIES AROUND" : label.toUpperCase(),
    title: many ? `${fresh.length} Muddies are around` : `${first.display_name} is ${label}`,
    person: many ? undefined : { displayName: first.display_name, avatarUrl: first.avatar_url },
    subtitle: many ? "See who's around and decide if you want to say hi." : "They're nearby. Proximity never means they're automatically available.",
    meta: many ? `${first.display_name} is ${label}` : label,
    cta: many ? "See Muddies" : "Open Profile",
    destination: many ? "/friends" : `/friends/${encodeURIComponent(first.username)}`
  };
}

/**
 * Events that start soon, split by whether the viewer actually COMMITTED.
 *
 * `isHost` or an RSVP of `going` is a commitment with a time attached, which
 * is the same shape as a Plan starting soon -- tier 2, and worth reaching a new
 * viewer during activation. `interested` is consideration: interrupting somebody
 * who has not yet made a first connection about an Event they merely bookmarked
 * is the noise this ranking exists to prevent, so it stays tier 4.
 *
 * One agenda pass, two states. The canonical fields decide; nothing re-queries
 * Events, and no runtime flag pretends one id means two things.
 */
function findEventStartingSoon(
  input: SmartCardInput,
  committed: boolean
): Extract<UpcomingAgendaItem, { kind: "event" }> | null {
  const found = input.agenda.find((item) => {
    if (item.kind !== "event") return false;
    const isCommitment = item.isHost || item.myRsvp === "going";
    if (isCommitment !== committed) return false;
    const delta = Date.parse(item.startsAt) - input.now.getTime();
    return Number.isFinite(delta) && delta > 0 && delta <= THREE_HOURS_MS;
  });
  return found && found.kind === "event" ? found : null;
}

function eventMedia(event: Extract<UpcomingAgendaItem, { kind: "event" }>) {
  /* The agenda already signed this cover in one batched pass. A card must never
     sign its own, or a stack of Events becomes a stack of round trips. */
  return event.coverUrl
    ? {
        url: event.coverUrl,
        alt: event.title + " cover",
        focalX: event.coverFocalX,
        focalY: event.coverFocalY
      }
    : undefined;
}

/** Tier 2: the viewer is hosting or going, and it starts soon. */
function eventCommitmentStartingProvider(input: SmartCardInput): SmartCard | null {
  const event = findEventStartingSoon(input, true);
  if (!event) return null;
  const minutes = minutesUntil(event.startsAt, input.now);
  const when = minutes === null ? "is starting soon" : soonLabel(minutes).toLowerCase();

  return {
    id: "event_commitment_starting",
    priority: 0,
    illustration: "calendar",
    eyebrow: event.isHost ? "YOU ARE HOSTING" : "STARTING SOON",
    title: event.isHost ? "You are hosting " + event.title : event.title,
    subtitle: event.isHost
      ? "It " + when + ". People are counting on you being there."
      : "It " + when + ".",
    meta: event.locationLabel ?? undefined,
    metaKind: event.locationLabel ? "location" : undefined,
    socialProof: event.isHost ? undefined : `Hosted by ${event.hostName}`,
    media: eventMedia(event),
    cta: "View Event",
    destination: event.href,
    expiresAt: expiresAt(event.startsAt)
  };
}

/** Tier 4: interested only. Useful, not urgent. */
function eventStartingProvider(input: SmartCardInput): SmartCard | null {
  const event = findEventStartingSoon(input, false);
  if (!event) return null;
  const minutes = minutesUntil(event.startsAt, input.now);

  return {
    id: "event_starting",
    priority: 0,
    illustration: "calendar",
    eyebrow: "COMING UP",
    title: event.title,
    subtitle: minutes === null ? "This Event is coming up." : soonLabel(minutes),
    meta: event.locationLabel ?? undefined,
    metaKind: event.locationLabel ? "location" : undefined,
    socialProof: `Hosted by ${event.hostName}`,
    media: eventMedia(event),
    cta: "View Event",
    destination: event.href,
    expiresAt: expiresAt(event.startsAt)
  };
}


function meetupStartingProvider(input: SmartCardInput): SmartCard | null {
  const nowMs = input.now.getTime();
  const meetup = (input.meetups ?? []).find((item) => {
    const delta = Date.parse(item.startsAt) - nowMs;
    return Number.isFinite(delta) && delta >= 0 && delta <= THREE_HOURS_MS;
  });
  if (!meetup) return null;
  const minutes = minutesUntil(meetup.startsAt, input.now);
  const title = meetup.title?.trim() || "Your Meetup";
  return {
    id: "meetup_starting",
    priority: 0,
    illustration: "people",
    eyebrow: "MEETUP SOON",
    title,
    subtitle: minutes === null ? "Your Meetup is starting soon." : soonLabel(minutes),
    meta: meetup.placeLabel || undefined,
    metaKind: meetup.placeLabel ? "location" : undefined,
    socialProof: meetup.sourceDiscoveryId ? "Meet New People · confirmed" : "Muddies · confirmed",
    cta: "Open Meetup",
    destination: `/meet-up?meetup=${encodeURIComponent(meetup.id)}`,
    expiresAt: expiresAt(meetup.startsAt)
  };
}

function meetupUpcomingProvider(input: SmartCardInput): SmartCard | null {
  const nowMs = input.now.getTime();
  const dayMs = 24 * 60 * 60 * 1000;
  const meetup = (input.meetups ?? []).find((item) => {
    const delta = Date.parse(item.startsAt) - nowMs;
    return Number.isFinite(delta) && delta > THREE_HOURS_MS && delta <= dayMs;
  });
  if (!meetup) return null;
  const title = meetup.title?.trim() || "Your Meetup";
  return {
    id: "meetup_upcoming",
    priority: 0,
    illustration: "people",
    eyebrow: "COMING UP",
    title,
    subtitle: meetup.sourceDiscoveryId
      ? "You matched with new people. The Meetup is agreed and ready."
      : "Your Meetup with your Muddies is agreed and ready.",
    meta: startsInLabel(meetup.startsAt, input.now) ?? meetup.placeLabel ?? undefined,
    metaKind: "time",
    cta: "Open Meetup",
    destination: `/meet-up?meetup=${encodeURIComponent(meetup.id)}`,
    expiresAt: expiresAt(meetup.startsAt)
  };
}

function meetupFallbackProvider(input: SmartCardInput): SmartCard {
  const newPeopleFirst = input.muddyCount === 0;
  return {
    id: "meetup_fallback",
    priority: 0,
    illustration: "people",
    eyebrow: "MEET UP",
    title: newPeopleFirst ? "Meet someone new nearby" : "Make something happen in real life",
    subtitle: newPeopleFirst
      ? "Create a short nearby listing. Mutual interest becomes a private, scheduled Meetup."
      : "Invite a Muddy you know or meet someone new nearby. Once you agree, one Meetup carries the time, chat and Glow.",
    cta: newPeopleFirst ? "Meet New People" : "Open Meet Up",
    destination: newPeopleFirst ? "/meet-up?newPeople=1" : "/meet-up"
  };
}

function birthdayProvider(input: SmartCardInput): SmartCard | null {
  if (!input.birthday) return null;
  const { birthdayToday, birthdayTomorrow } = input.birthday;
  if (!birthdayToday && !birthdayTomorrow) return null;

  const expiry = new Date(input.now);
  if (birthdayTomorrow) {
    /*
     * "Tomorrow" becomes false at the START of the birthday, not at the end of
     * it. Refresh at midnight so Home can immediately graduate to YOUR DAY
     * instead of spending the birthday still saying it is tomorrow.
     */
    expiry.setDate(expiry.getDate() + 1);
    expiry.setHours(0, 0, 0, 0);
  } else {
    expiry.setHours(23, 59, 59, 999);
  }

  return {
    id: "birthday",
    priority: 0,
    illustration: "birthday",
    eyebrow: birthdayToday ? "YOUR DAY" : "TOMORROW",
    title: birthdayToday ? "Happy birthday!" : "Your birthday is tomorrow",
    subtitle: birthdayToday ? "Make the day yours with the people who matter." : "Want to put something together?",
    cta: birthdayToday ? "See Your Profile" : "Start a Meetup",
    destination: birthdayToday ? "/profile" : "/meet-up",
    expiresAt: expiry.getTime()
  };
}

/** Tier 5: progression is useful, but never outranks real social life. */
function journeyProvider(input: SmartCardInput): SmartCard | null {
  const journey = input.journey;
  if (!journey?.currentStep) return null;
  const remaining = Math.max(0, journey.totalCount - journey.completedCount);
  return {
    id: "journey",
    priority: 0,
    illustration: "target",
    eyebrow: "YOUR JOURNEY",
    title: journey.currentStep.title,
    subtitle: journey.currentStep.description,
    cta: "Continue Journey",
    destination: journey.currentStep.destination,
    progress: smartCardProgress(
      journey.completedCount,
      journey.totalCount,
      remaining === 1 ? "One step remaining" : `${remaining} steps remaining`
    )
  };
}

function journeyCompleteProvider(input: SmartCardInput): SmartCard | null {
  const journey = input.journey;
  if (!journey || journey.totalCount === 0 || journey.completedCount < journey.totalCount) return null;
  return {
    id: "journey_complete",
    priority: 0,
    illustration: "celebration",
    eyebrow: "MILESTONE",
    title: "Journey complete",
    subtitle: "You've completed the current Journey. See how far you've come.",
    cta: "View My Progress",
    destination: "/buddy-score",
    progress: smartCardProgress(journey.totalCount, journey.totalCount, "All steps complete"),
    dismissible: true
  };
}

function buddyProgressProvider(input: SmartCardInput): SmartCard | null {
  const score = input.buddyScore;
  if (!score?.nextLevel || score.pointsToNext <= 0) return null;
  return {
    id: "buddy_progress",
    priority: 0,
    illustration: "trophy",
    eyebrow: "BUDDY SCORE",
    title: `${score.pointsToNext} points to ${score.nextLevel.label}`,
    subtitle: "Keep connecting with your Muddies and the next level will follow.",
    cta: "View My Progress",
    destination: "/buddy-score",
    progress: {
      percent: Math.min(100, Math.max(0, Math.round(score.progressPercent))),
      label: `Next: ${score.nextLevel.label}`
    }
  };
}

function achievementProvider(input: SmartCardInput): SmartCard | null {
  const achievement = input.recentAchievement;
  if (!achievement) return null;
  return {
    id: "achievement",
    priority: 0,
    illustration: "trophy",
    eyebrow: "MILESTONE",
    title: achievement.title,
    subtitle: "You hit a new milestone in your Journey.",
    cta: "View Achievement",
    destination: "/buddy-score",
    /*
     * Achievements repeat over a person's lifetime. A generic "achievement"
     * acknowledgement would permanently silence the whole family after the
     * first tap; the canonical achievement code is unique per user and makes
     * the acknowledgement about THIS earned badge.
     */
    acknowledgementKey: `achievement:${achievement.code}`,
    expiresAt: expiresAt(achievement.expiresAt),
    dismissible: true
  };
}

/** Cold-start people help. Once the viewer has Muddies, this yields to UpFor. */
function suggestionsProvider(input: SmartCardInput): SmartCard | null {
  if (input.muddyCount > 0) return null;
  const count = input.suggestionCount;
  return {
    id: "suggestions",
    priority: 0,
    illustration: "people",
    eyebrow: "START WITH PEOPLE YOU KNOW",
    title: count > 0 ? "People you may know" : "Find your first Muddy",
    subtitle: count > 0 ? `${count} ${count === 1 ? "person" : "people"} you might already know are on Mad Buddy.` : "Mad Buddy gets useful fast once one real person is in your circle.",
    cta: count > 0 ? "See Suggestions" : "Find Muddies",
    destination: "/friends"
  };
}

/**
 * Guaranteed fallback: UpFor is available to everyone.
 * The last provider always returns a card so Home never blanks.
 */

/* ---------------------------------------------------------------------------
 * UpFor.
 *
 * Every state below reads the SAME batched context (lib/social/home-upfor-context)
 * and the canonical activity labels. No provider queries anything, and none
 * assumes a single active session: somebody running a coffee and a gym UpFor at
 * once is ordinary, so the owner states summarise across all of them.
 * ------------------------------------------------------------------------ */

/** Tier 1: people are waiting on the owner's answer. That is an obligation. */

/**
 * Tier 2: a Muddy is UpFor something the viewer has NOT acted on yet.
 *
 * THE DISCOVERY HALF OF THE LIFECYCLE, which Home was missing. The catalog has
 * always described `upfor_active_muddy` as "a relevant Muddy is UpFor something
 * now", but the wiring only ever looked at sessions the viewer had ALREADY
 * requested to join -- so the moment the state exists for never reached Home,
 * and a real phone found it: somebody else put out an UpFor and Home said
 * nothing.
 *
 * Grounded, never a recommendation: this is an actual live session belonging to
 * an actual Muddy, already filtered by the reader for audience, block and
 * lifecycle. No scoring, no ranking model, no proximity claim.
 *
 * It ranks BELOW the states about UpFors the viewer is already in, because
 * something you have committed to outranks something you might join.
 */

/** Tier 2: the viewer asked to join a Muddy's live UpFor and is waiting. */

/** Tier 2: the owner's UpFor is gathering real interest. */

/** Tier 2: somebody said yes to the viewer. */

/** Tier 2: the owner's own scheduled UpFor is about to begin. */

/** Tier 4: something the viewer scheduled, further out. */

/* ---------------------------------------------------------------------------
 * Relationships.
 *
 * Card A owns the FIRST Muddy and cold-start discovery, so nothing here
 * duplicates them: these are states about people the viewer already has some
 * relationship with.
 * ------------------------------------------------------------------------ */

/** Tier 1: somebody asked to connect and is waiting on an answer. */
function muddyRequestProvider(input: SmartCardInput): SmartCard | null {
  const count = input.incomingRequestCount ?? 0;
  if (count <= 0) return null;

  return {
    id: "muddy_request",
    priority: 0,
    illustration: "people",
    eyebrow: "NEEDS YOUR RESPONSE",
    title:
      count === 1 ? "Someone wants to be your Muddy" : count + " people want to be your Muddies",
    subtitle: "They are waiting to hear back from you.",
    cta: "Review requests",
    /* The REQUESTS tab, not the Muddies index. `/friends` defaults to "all",
       so the card named a screen and then opened a different one -- the person
       had to find the requests the card had just told them about. */
    destination: "/friends?tab=requests"
  };
}

/**
 * Tier 3: a Linkr match who has not been spoken to yet.
 *
 * GROUNDED, NOT A RECOMMENDATION. This never surfaces a Linkr suggestion --
 * only a MUTUAL connection, where both people already chose each other. A pair
 * who are already talking is not a moment, so hasConversation filters them
 * out rather than nagging about a conversation that exists.
 */
function linkrMutualProvider(input: SmartCardInput): SmartCard | null {
  const unspoken = currentLinkrMutuals(input);
  if (unspoken.length === 0) return null;
  const first = unspoken[0];

  return {
    id: "linkr_mutual",
    priority: 0,
    illustration: "people",
    eyebrow: "YOU BOTH CONNECTED",
    title: "You and " + first.displayName + " connected",
    person: { displayName: first.displayName, avatarUrl: first.photo },
    subtitle: "You both chose to connect. Say hi when you're ready.",
    socialProof:
      unspoken.length > 1 ? unspoken.length + " recent Linkr connections" : undefined,
    cta: "Say hi",
    destination: linkrPairDestination(first.connectionId),
    media: first.photo ? { url: first.photo, alt: first.displayName } : undefined,
    expiresAt: linkrMutualExpiry(first)
  };
}

/**
 * Tier 3: the same mutual moment, but the pair can be told WHERE they met.
 *
 * Ranked above the plain mutual because a shared Event is the thing that makes
 * a first message easy to write -- "we met at Acoustic Night" is a conversation
 * opener in a way "we matched" is not.
 *
 * THE EVENT IS THE PAIR'S OWN STORED FACT. `eventName` comes from
 * `linkr_connections.event_id`, written when they connected through Event Mode.
 * Nothing here compares two attendance lists, so a pair who each went to the
 * same Event separately and connected through ordinary Linkr stays on the plain
 * `linkr_mutual` card. Mutual-only still holds: this reads the same collection,
 * which contains connections and never one-sided interest.
 */
function linkrMutualEventProvider(input: SmartCardInput): SmartCard | null {
  const withEvent = currentLinkrMutuals(input).filter((person) => Boolean(person.eventName));
  if (withEvent.length === 0) return null;
  const first = withEvent[0];

  return {
    id: "linkr_mutual_event",
    priority: 0,
    illustration: "people",
    eyebrow: "YOU BOTH CONNECTED",
    title: "You connected at " + first.eventName,
    person: { displayName: first.displayName, avatarUrl: first.photo },
    subtitle: "You and " + first.displayName + " both chose to connect.",
    cta: "Say hi",
    destination: linkrPairDestination(first.connectionId),
    /* Opening a Plan with somebody you have not spoken to yet is a big second
       step, so it stays SECONDARY and the first message stays primary. */
    secondaryAction: { label: "Make a Plan", destination: "/plans?create=1" },
    media: first.photo ? { url: first.photo, alt: first.displayName } : undefined,
    expiresAt: linkrMutualExpiry(first)
  };
}

/**
 * Tier 2: the viewer is checked in somewhere and could opt into Event Linkr.
 *
 * THE CHAIN THIS STATE RESPECTS, in full:
 *
 *   going  ->  actual check-in  ->  Event Linkr consent  ->  discovery
 *
 * Each arrow is a separate decision, and this card sits on exactly ONE of them:
 * the offer to make the third. It appears only when the Events side has already
 * said the viewer holds a LIVE check-in and has NOT yet consented -- the
 * `no_consent` answer from resolveEventLinkrEligibility, which is the same
 * authority the Event screen itself uses. Being invited, going, or interested
 * never reaches here, because none of those is a check-in.
 *
 * IT OFFERS, IT DOES NOT CONSENT. The card links to the Event, where the real
 * opt-in control lives. Consent is never granted from Home, and this card never
 * says or implies the viewer is already discoverable.
 */
function eventLinkrReadyProvider(input: SmartCardInput): SmartCard | null {
  const offer = input.eventLinkrOffer;
  if (!offer) return null;

  return {
    id: "event_linkr_ready",
    priority: 0,
    illustration: "people",
    eyebrow: "YOU'RE CHECKED IN",
    title: "Meet people at " + offer.eventName + "?",
    subtitle: "Choose whether to be discoverable to others here.",
    cta: "See how it works",
    destination: offer.href,
    expiresAt: expiresAt(offer.endsAt)
  };
}

/**
 * Tier 3: a Muddy's birthday the viewer has ALREADY been told about.
 *
 * NO RAW DATE OF BIRTH IS READ ANYWHERE ON THIS PATH. The input is the birthday
 * DELIVERY LEDGER -- the record of notifications the birthday job actually
 * sent -- and reaching that ledger already required the owner's field privacy
 * to be `approved_muddies`, their announcement preference to be on, a live
 * friendship, and no block in either direction. Home therefore repeats a fact
 * the product has already decided this viewer may know, rather than deriving a
 * new one from somebody's date of birth.
 *
 * It links to Notifications because that is where the canonical wish flow
 * lives. Home does not grow a second birthday surface.
 */
function muddyBirthdayProvider(input: SmartCardInput): SmartCard | null {
  const birthdays = input.muddyBirthdays ?? [];
  if (birthdays.length === 0) return null;
  const first = birthdays[0];

  return {
    id: "muddy_birthday",
    priority: 0,
    illustration: "birthday",
    eyebrow: "TODAY",
    title: "It's " + first.displayName + "'s birthday 🎉",
    person: { displayName: first.displayName, avatarUrl: first.avatarUrl },
    subtitle:
      birthdays.length > 1
        ? birthdays.length + " of your Muddies are celebrating today."
        : "Send them a birthday wish.",
    /* "Open birthday wishes", not "Send a message". The tap opens Notifications,
       where the birthday row opens the wish composer -- it does not open a
       composer directly, and it certainly does not send anything. Building a
       second birthday-message flow on Home to justify the shorter label would
       be two surfaces answering one question. */
    cta: "Open birthday wishes",
    destination: "/notifications",
    expiresAt: endOfLocalDayMs(input.now)
  };
}

/* --------------------------------------------------------------------------
 * Decisions and coordination.
 *
 * Home surfaces DECISIONS, not correspondence. Every state below is built from
 * a structured, countable decision somebody is blocked on -- an open poll with
 * the viewer's vote missing -- and never from unread counts or message text.
 * That boundary is what keeps Home from becoming a second inbox.
 * ------------------------------------------------------------------------ */

/**
 * Tier 1: an open Plan poll the viewer has not voted in.
 *
 * ELIGIBILITY IS THE SAME QUESTION THE VOTE ITSELF ASKS. The reader admits a
 * poll only when it is `open`, has not passed `closes_at`, belongs to a Plan
 * already on the viewer's permission-filtered agenda, and has no vote from
 * them. "A poll exists" is not enough, and neither is "the Plan is polling":
 * somebody who has already voted is owed nothing and must not be asked again.
 *
 * The card OPENS the canonical poll UI rather than voting from Home, so its
 * label says what it does.
 */

/**
 * Tier 2: a Plan Chat holding an open poll the viewer has not answered.
 *
 * A STRUCTURED DECISION, NOT UNREAD MESSAGES. This reads `chat_polls` -- a poll
 * somebody deliberately created in the conversation -- and never message text,
 * never an unread count, and never a preview. There is no classification of
 * what a conversation is "about"; the poll's own question is the context, and
 * it exists because a person wrote it as a question.
 *
 * Membership is the reader's job and is not re-derived here: a conversation the
 * viewer cannot access never reaches this provider, so no poll question can
 * escape a chat the viewer is not in.
 */

/* --------------------------------------------------------------------------
 * Growth and recovery.
 * ------------------------------------------------------------------------ */

/**
 * Tier 5: a feature the viewer TURNED ON that their profile blocks.
 *
 * NOT PROFILE COMPLETION. This never says "your profile is 70% complete" and
 * never counts optional fields. It appears only when the person made an
 * explicit, durable choice to enable a feature and that feature's OWN rules
 * then refuse to show them -- so the effect is invisible to them: they switched
 * Linkr on and simply never appear.
 *
 * The outstanding requirement is the feature's own sentence, passed through
 * rather than restated, so Home cannot drift into a second definition of what
 * "ready" means.
 */
function profileBlockingProvider(input: SmartCardInput): SmartCard | null {
  const blocked = input.blockedFeature;
  if (!blocked) return null;

  return {
    id: "profile_blocking",
    priority: 0,
    illustration: "target",
    eyebrow: "FINISH SETUP",
    title: blocked.requirement,
    subtitle: `${blocked.feature} is on, but nobody can see you until this is done.`,
    cta: "Finish profile",
    destination: blocked.href
  };
}

export function smartCardProviders(input: SmartCardInput): readonly SmartCardProvider[] {
  const providers: SmartCardProvider[] = [
    { id: "muddy_request", build: () => muddyRequestProvider(input) },
    { id: "meetup_starting", build: () => meetupStartingProvider(input) },
    { id: "event_live", build: () => eventLiveProvider(input) },
    { id: "event_commitment_starting", build: () => eventCommitmentStartingProvider(input) },
    { id: "event_linkr_ready", build: () => eventLinkrReadyProvider(input) },
    { id: "nearby_muddies", build: () => nearbyMuddiesProvider(input) },
    { id: "meetup_upcoming", build: () => meetupUpcomingProvider(input) },
    { id: "event_starting", build: () => eventStartingProvider(input) },
    { id: "linkr_mutual_event", build: () => linkrMutualEventProvider(input) },
    { id: "linkr_mutual", build: () => linkrMutualProvider(input) },
    { id: "muddy_birthday", build: () => muddyBirthdayProvider(input) },
    { id: "birthday", build: () => birthdayProvider(input) },
    { id: "journey", build: () => journeyProvider(input) },
    { id: "journey_complete", build: () => journeyCompleteProvider(input) },
    { id: "buddy_progress", build: () => buddyProgressProvider(input) },
    { id: "achievement", build: () => achievementProvider(input) },
    { id: "suggestions", build: () => suggestionsProvider(input) },
    { id: "profile_blocking", build: () => profileBlockingProvider(input) },
    { id: "meetup_fallback", build: () => meetupFallbackProvider(input) }
  ];
  if (!input.availability) return providers;
  return providers.map((provider) => ({
    ...provider,
    build: () => availableSmartCard(provider.build(), input.availability!)
  }));
}
