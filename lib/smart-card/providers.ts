/**
 * Pure Smart Card providers.
 *
 * Every provider is a deterministic function of SmartCardInput. No queries,
 * no randomness and no hidden ranking model live here. Home loads canonical
 * facts once, then the engine chooses the first truthful applicable state.
 */

import type { HomeUpForContext } from "@/lib/social/home-upfor-context";
import type { LinkrMutualForCard } from "@/lib/smart-card/linkr-context";
import type {
  BlockedFeatureForCard,
  EventLinkrOfferForCard,
  MuddyBirthdayForCard,
  PlanChatDecisionForCard,
  PlanDecisionForCard
} from "@/lib/smart-card/home-context";
import { upForActivitySmartCardMedia } from "@/lib/smart-card/visuals";
import type { BuddyScoreData } from "@/lib/engagement/buddy-score-service";
import type { JourneyData } from "@/lib/journey/journey";
import type { UpcomingAgendaItem } from "@/lib/social/upcoming-agenda-projection";
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
  journey: JourneyData | null;
  safeArrival: { travelling: boolean; watcherCount: number } | null;
  birthday: { birthdayToday: boolean; birthdayTomorrow: boolean } | null;
  /** Canonical Home agenda — Plans + Events, already permission-filtered. */
  agenda: readonly UpcomingAgendaItem[];
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
  recentAchievement: { title: string } | null;
  suggestionCount: number;
};

const THREE_HOURS_MS = 3 * 60 * 60 * 1000;

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
function safeArrivalProvider(input: SmartCardInput): SmartCard | null {
  if (!input.safeArrival?.travelling) return null;
  const { watcherCount } = input.safeArrival;
  return {
    id: "safe_arrival",
    priority: 0,
    illustration: "people",
    eyebrow: "SAFE ARRIVAL",
    title: "You're on a journey",
    subtitle:
      watcherCount > 0
        ? `${watcherCount} ${watcherCount === 1 ? "Muddy is" : "Muddies are"} checking on you. Confirm when you arrive.`
        : "Confirm your arrival when you get there.",
    cta: "Open Safe Arrival",
    destination: "/safe-arrival"
  };
}

/** Tier 1: a Plan invitation is a real person waiting for an answer. */
function planRsvpProvider(input: SmartCardInput): SmartCard | null {
  const plan = input.agenda.find(
    (item) => item.kind === "plan" && (item.myRsvp === "invited" || item.myRsvp === "viewed")
  );
  if (!plan || plan.kind !== "plan") return null;

  return {
    id: "plan_rsvp",
    priority: 0,
    illustration: "calendar",
    eyebrow: "NEEDS YOUR RESPONSE",
    title: `${plan.title} needs your answer`,
    subtitle:
      plan.goingCount > 0
        ? `${plan.goingCount} ${plan.goingCount === 1 ? "person is" : "people are"} already going.`
        : `${plan.organiserName} invited you.`,
    socialProof: plan.attendees.length > 0 ? `${plan.attendees.map((person) => person.name).slice(0, 2).join(", ")} ${plan.goingCount > 2 ? `+${plan.goingCount - 2}` : ""}`.trim() : undefined,
    /* "Respond", not "RSVP". The tap OPENS the Plan, where the real RSVP
       controls live; it does not answer on the viewer's behalf. A button
       reading "RSVP" promises the answer is being given by pressing it, which
       is a small lie the moment the next screen asks the question again. */
    cta: "Respond",
    destination: `/plans?plan=${plan.id}`
  };
}

/** Tier 2: a Plan the viewer is already part of is close enough to matter now. */
function planStartingProvider(input: SmartCardInput): SmartCard | null {
  const plan = input.agenda.find((item) => {
    if (item.kind !== "plan") return false;
    if (item.myRsvp === "invited" || item.myRsvp === "viewed" || item.myRsvp === "not_going") return false;
    const delta = Date.parse(item.startsAt) - input.now.getTime();
    return Number.isFinite(delta) && delta >= 0 && delta <= THREE_HOURS_MS;
  });
  if (!plan || plan.kind !== "plan") return null;
  const minutes = minutesUntil(plan.startsAt, input.now);

  return {
    id: "plan_starting",
    priority: 0,
    illustration: "calendar",
    eyebrow: "STARTING SOON",
    title: plan.title,
    subtitle: minutes === null ? "Your Plan is coming up." : `${soonLabel(minutes)}. Open it for the latest details.`,
    meta: plan.placeText ?? undefined,
    socialProof: plan.goingCount > 0 ? `${plan.goingCount} going${plan.maybeCount > 0 ? ` · ${plan.maybeCount} maybe` : ""}` : undefined,
    cta: "Open Plan",
    destination: `/plans?plan=${plan.id}`
  };
}

/** Tier 2: a relevant Event that is actually live, not merely discoverable. */
function eventLiveProvider(input: SmartCardInput): SmartCard | null {
  const event = input.agenda.find((item) => {
    if (item.kind !== "event") return false;
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
    media: event.coverUrl ? { url: event.coverUrl, alt: `${event.title} cover`, focalX: event.coverFocalX, focalY: event.coverFocalY } : undefined,
    cta: "View Event",
    destination: event.href
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
    media: eventMedia(event),
    cta: "View Event",
    destination: event.href
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
    media: eventMedia(event),
    cta: "View Event",
    destination: event.href
  };
}

function birthdayProvider(input: SmartCardInput): SmartCard | null {
  if (!input.birthday) return null;
  const { birthdayToday, birthdayTomorrow } = input.birthday;
  if (!birthdayToday && !birthdayTomorrow) return null;

  const expiry = new Date(input.now);
  if (birthdayTomorrow) expiry.setDate(expiry.getDate() + 1);
  expiry.setHours(23, 59, 59, 999);

  return {
    id: "birthday",
    priority: 0,
    illustration: "birthday",
    eyebrow: birthdayToday ? "YOUR DAY" : "TOMORROW",
    title: birthdayToday ? "Happy birthday!" : "Your birthday is tomorrow",
    subtitle: birthdayToday ? "Make the day yours with the people who matter." : "Want to put something together?",
    cta: birthdayToday ? "See Your Profile" : "Make a Plan",
    destination: birthdayToday ? "/profile" : "/plans",
    expiresAt: expiry.getTime()
  };
}

function weekendPlansProvider(input: SmartCardInput): SmartCard | null {
  if (!isWeekendPlanningWindow(input.now)) return null;
  const count = input.weekendPlanCount;
  return {
    id: "weekend_plans",
    priority: 0,
    illustration: "calendar",
    eyebrow: "THIS WEEKEND",
    title: count > 0 ? "Your weekend is taking shape" : "Make weekend plans",
    subtitle: count > 0 ? `You have ${count} ${count === 1 ? "Plan" : "Plans"} coming up.` : "Nothing on yet. Put something together with your Muddies.",
    cta: count > 0 ? "View Plans" : "Create a Plan",
    destination: "/plans",
    expiresAt: weekendWindowExpiry(input.now)
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
    subtitle: "Progress matters after the real social stuff, not instead of it.",
    cta: "View My Progress",
    destination: "/buddy-score",
    progress: {
      percent: Math.min(100, Math.max(0, Math.round(score.progressPercent))),
      label: `Next: ${score.nextLevel.label}`
    }
  };
}

function achievementProvider(input: SmartCardInput): SmartCard | null {
  if (!input.recentAchievement) return null;
  return {
    id: "achievement",
    priority: 0,
    illustration: "trophy",
    eyebrow: "MILESTONE",
    title: input.recentAchievement.title,
    subtitle: "A new achievement is ready in your Journey.",
    cta: "View Achievement",
    destination: "/buddy-score",
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

/** Guaranteed fallback: social intent, not progression or product promotion. */
function upForFallbackProvider(): SmartCard {
  return {
    id: "upfor_fallback",
    priority: 0,
    illustration: "people",
    eyebrow: "UPFOR",
    title: "What are you UpFor today?",
    subtitle: "Put out a lightweight intent and see who wants in.",
    cta: "Open UpFor",
    destination: "/hangout-mode"
  };
}


/* ---------------------------------------------------------------------------
 * UpFor.
 *
 * Every state below reads the SAME batched context (lib/social/home-upfor-context)
 * and the canonical activity labels. No provider queries anything, and none
 * assumes a single active session: somebody running a coffee and a gym UpFor at
 * once is ordinary, so the owner states summarise across all of them.
 * ------------------------------------------------------------------------ */

/** Tier 1: people are waiting on the owner's answer. That is an obligation. */
function upForRequestsProvider(input: SmartCardInput): SmartCard | null {
  const owned = input.upFor?.ownedLive ?? [];
  const waiting = owned.filter((session) => session.pendingRequestCount > 0);
  if (waiting.length === 0) return null;

  const total = waiting.reduce((sum, session) => sum + session.pendingRequestCount, 0);
  const first = waiting[0];
  const many = waiting.length > 1;

  return {
    id: "upfor_requests",
    priority: 0,
    illustration: "people",
    eyebrow: "NEEDS YOUR RESPONSE",
    title:
      total === 1
        ? "Someone wants to join your " + first.activityLabel + " UpFor"
        : total + " people want to join your " + (many ? "UpFors" : first.activityLabel + " UpFor"),
    subtitle: "They are waiting on you before anything can happen.",
    cta: "Review requests",
    destination: "/hangout-mode",
    media: many ? undefined : upForActivitySmartCardMedia(first.activityType, first.activityLabel)
  };
}

/** Tier 2: the viewer asked to join a Muddy's live UpFor and is waiting. */
function upForActiveMuddyProvider(input: SmartCardInput): SmartCard | null {
  const joined = input.upFor?.joined ?? [];
  /* Only sessions the viewer has NOT been answered on belong here; an accepted
     request is a different, happier state below. */
  const pending = joined.filter((session) => session.myStatus === "pending");
  if (pending.length === 0) return null;
  const first = pending[0];

  return {
    id: "upfor_active_muddy",
    priority: 0,
    illustration: "people",
    eyebrow: "HAPPENING NOW",
    title: first.ownerName + " is UpFor " + first.activityLabel.toLowerCase(),
    subtitle: "You asked to join. They will see it and decide.",
    meta: "Waiting on them",
    cta: "Details",
    destination: "/hangout-mode",
    media: upForActivitySmartCardMedia(first.activityType, first.activityLabel)
  };
}

/** Tier 2: the owner's UpFor is gathering real interest. */
function upForMomentumProvider(input: SmartCardInput): SmartCard | null {
  const owned = input.upFor?.ownedLive ?? [];
  /* Momentum means people said yes, not that requests exist -- pending requests
     are the tier-1 obligation above and must not be counted twice. */
  const gathering = owned.filter(
    (session) => session.acceptedCount > 0 && session.pendingRequestCount === 0
  );
  if (gathering.length === 0) return null;
  const first = gathering[0];

  return {
    id: "upfor_momentum",
    priority: 0,
    illustration: "people",
    eyebrow: "GATHERING",
    title: "Your " + first.activityLabel + " UpFor is happening",
    subtitle:
      first.acceptedCount === 1
        ? "One Muddy is in. It only takes one."
        : first.acceptedCount + " Muddies are in.",
    cta: "Manage UpFor",
    destination: "/hangout-mode",
    media: upForActivitySmartCardMedia(first.activityType, first.activityLabel)
  };
}

/** Tier 2: somebody said yes to the viewer. */
function upForAcceptedProvider(input: SmartCardInput): SmartCard | null {
  const accepted = (input.upFor?.joined ?? []).filter((session) => session.myStatus === "accepted");
  if (accepted.length === 0) return null;
  const first = accepted[0];

  return {
    id: "upfor_accepted",
    priority: 0,
    illustration: "celebration",
    eyebrow: "YOU ARE IN",
    title: first.ownerName + " said yes",
    subtitle: "You are going to " + first.activityLabel.toLowerCase() + ".",
    cta: "Open UpFor",
    destination: "/hangout-mode",
    media: upForActivitySmartCardMedia(first.activityType, first.activityLabel)
  };
}

/** Tier 2: the owner's own scheduled UpFor is about to begin. */
function ownedUpForStartingProvider(input: SmartCardInput): SmartCard | null {
  const scheduled = input.upFor?.ownedScheduled ?? [];
  const soon = scheduled.find((session) => {
    if (!session.startsAt) return false;
    const delta = Date.parse(session.startsAt) - input.now.getTime();
    return Number.isFinite(delta) && delta > 0 && delta <= THREE_HOURS_MS;
  });
  if (!soon || !soon.startsAt) return null;
  const minutes = minutesUntil(soon.startsAt, input.now);

  return {
    id: "owned_upfor_starting",
    priority: 0,
    illustration: "calendar",
    eyebrow: "STARTING SOON",
    title:
      "Your " +
      soon.activityLabel +
      " UpFor " +
      (minutes === null ? "is coming up" : soonLabel(minutes).toLowerCase()),
    subtitle:
      soon.acceptedCount > 0
        ? soon.acceptedCount + (soon.acceptedCount === 1 ? " Muddy is in." : " Muddies are in.")
        : "It goes live automatically. Muddies can join from there.",
    cta: "Manage UpFor",
    destination: "/hangout-mode",
    media: upForActivitySmartCardMedia(soon.activityType, soon.activityLabel)
  };
}

/** Tier 4: something the viewer scheduled, further out. */
function upForScheduledProvider(input: SmartCardInput): SmartCard | null {
  const scheduled = input.upFor?.ownedScheduled ?? [];
  if (scheduled.length === 0) return null;
  const first = scheduled[0];
  const minutes = first.startsAt ? minutesUntil(first.startsAt, input.now) : null;

  return {
    id: "upfor_scheduled",
    priority: 0,
    illustration: "calendar",
    eyebrow: "COMING UP",
    title: "Your " + first.activityLabel + " UpFor is set",
    subtitle:
      scheduled.length > 1
        ? scheduled.length + " UpFors scheduled."
        : "Nobody sees it until it starts.",
    meta: minutes === null ? undefined : soonLabel(minutes),
    cta: "Manage UpFor",
    destination: "/hangout-mode",
    media: upForActivitySmartCardMedia(first.activityType, first.activityLabel)
  };
}


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
    destination: "/friends"
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
  const unspoken = (input.linkrMutuals ?? []).filter((person) => !person.hasConversation);
  if (unspoken.length === 0) return null;
  const first = unspoken[0];

  return {
    id: "linkr_mutual",
    priority: 0,
    illustration: "people",
    eyebrow: "YOU BOTH CONNECTED",
    title: "You and " + first.displayName + " connected",
    subtitle:
      unspoken.length > 1
        ? unspoken.length + " Linkr connections are waiting for a first message."
        : "Neither of you has said anything yet.",
    cta: "Say hi",
    destination: "/linkr",
    media: first.photo ? { url: first.photo, alt: first.displayName } : undefined
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
  const withEvent = (input.linkrMutuals ?? []).filter(
    (person) => !person.hasConversation && Boolean(person.eventName)
  );
  if (withEvent.length === 0) return null;
  const first = withEvent[0];

  return {
    id: "linkr_mutual_event",
    priority: 0,
    illustration: "people",
    eyebrow: "YOU BOTH CONNECTED",
    title: "You connected at " + first.eventName,
    subtitle: "You and " + first.displayName + " both chose to connect.",
    cta: "Say hi",
    destination: "/linkr",
    /* Opening a Plan with somebody you have not spoken to yet is a big second
       step, so it stays SECONDARY and the first message stays primary. */
    secondaryAction: { label: "Make a Plan", destination: "/plans" },
    media: first.photo ? { url: first.photo, alt: first.displayName } : undefined
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
    destination: offer.href
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
    subtitle:
      birthdays.length > 1
        ? birthdays.length + " of your Muddies are celebrating today."
        : "Send them a birthday wish.",
    cta: "Send a message",
    destination: "/notifications"
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
function planDecisionProvider(input: SmartCardInput): SmartCard | null {
  const decisions = input.planDecisions ?? [];
  if (decisions.length === 0) return null;
  const first = decisions[0];

  return {
    id: "plan_decision",
    priority: 0,
    illustration: "calendar",
    eyebrow: "NEEDS YOUR ANSWER",
    title: first.planTitle + " needs a decision",
    subtitle:
      first.voterCount > 0
        ? `${first.voterCount} ${first.voterCount === 1 ? "person has" : "people have"} voted. Yours is still missing.`
        : "Nobody has voted yet. Yours would be the first.",
    /* The poll's own question, so the card says what is being decided rather
       than making the person open it to find out. */
    meta: first.question,
    cta: "Vote now",
    destination: "/plans"
  };
}

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
function planChatDecisionProvider(input: SmartCardInput): SmartCard | null {
  const decisions = input.planChatDecisions ?? [];
  if (decisions.length === 0) return null;
  const first = decisions[0];

  return {
    id: "plan_chat_decision",
    priority: 0,
    illustration: "people",
    eyebrow: "BEING DECIDED",
    title: first.planTitle ? first.planTitle + " is deciding" : "A Plan is deciding",
    subtitle: first.question,
    cta: "Open chat",
    destination: "/messages"
  };
}

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
  return [
    { id: "safe_arrival", build: () => safeArrivalProvider(input) },
    { id: "plan_rsvp", build: () => planRsvpProvider(input) },
    { id: "plan_decision", build: () => planDecisionProvider(input) },
    { id: "upfor_requests", build: () => upForRequestsProvider(input) },
    { id: "muddy_request", build: () => muddyRequestProvider(input) },
    { id: "plan_starting", build: () => planStartingProvider(input) },
    { id: "event_live", build: () => eventLiveProvider(input) },
    { id: "event_commitment_starting", build: () => eventCommitmentStartingProvider(input) },
    { id: "plan_chat_decision", build: () => planChatDecisionProvider(input) },
    { id: "event_linkr_ready", build: () => eventLinkrReadyProvider(input) },
    { id: "upfor_active_muddy", build: () => upForActiveMuddyProvider(input) },
    { id: "upfor_momentum", build: () => upForMomentumProvider(input) },
    { id: "upfor_accepted", build: () => upForAcceptedProvider(input) },
    { id: "owned_upfor_starting", build: () => ownedUpForStartingProvider(input) },
    { id: "nearby_muddies", build: () => nearbyMuddiesProvider(input) },
    { id: "event_starting", build: () => eventStartingProvider(input) },
    { id: "linkr_mutual_event", build: () => linkrMutualEventProvider(input) },
    { id: "linkr_mutual", build: () => linkrMutualProvider(input) },
    { id: "muddy_birthday", build: () => muddyBirthdayProvider(input) },
    { id: "birthday", build: () => birthdayProvider(input) },
    { id: "weekend_plans", build: () => weekendPlansProvider(input) },
    { id: "upfor_scheduled", build: () => upForScheduledProvider(input) },
    { id: "journey", build: () => journeyProvider(input) },
    { id: "journey_complete", build: () => journeyCompleteProvider(input) },
    { id: "buddy_progress", build: () => buddyProgressProvider(input) },
    { id: "achievement", build: () => achievementProvider(input) },
    { id: "suggestions", build: () => suggestionsProvider(input) },
    { id: "profile_blocking", build: () => profileBlockingProvider(input) },
    { id: "upfor_fallback", build: () => upForFallbackProvider() }
  ];
}
