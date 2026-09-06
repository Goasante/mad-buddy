/**
 * Pure Smart Card providers.
 *
 * Every provider is a deterministic function of SmartCardInput. No queries,
 * no randomness and no hidden ranking model live here. Home loads canonical
 * facts once, then the engine chooses the first truthful applicable state.
 */

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
    cta: "RSVP",
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
    cta: many ? "See Muddies" : "Say Hi",
    destination: many ? "/friends" : `/friends/${first.friend_id}`
  };
}

/** Tier 4: a relevant Event is close, but not more urgent than live social context. */
function eventStartingProvider(input: SmartCardInput): SmartCard | null {
  const event = input.agenda.find((item) => {
    if (item.kind !== "event") return false;
    const delta = Date.parse(item.startsAt) - input.now.getTime();
    return Number.isFinite(delta) && delta > 0 && delta <= THREE_HOURS_MS;
  });
  if (!event || event.kind !== "event") return null;
  const minutes = minutesUntil(event.startsAt, input.now);

  return {
    id: "event_starting",
    priority: 0,
    illustration: "calendar",
    eyebrow: "COMING UP",
    title: event.title,
    subtitle: minutes === null ? "This Event is coming up." : soonLabel(minutes),
    meta: event.locationLabel ?? undefined,
    media: event.coverUrl ? { url: event.coverUrl, alt: `${event.title} cover`, focalX: event.coverFocalX, focalY: event.coverFocalY } : undefined,
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

export function smartCardProviders(input: SmartCardInput): readonly SmartCardProvider[] {
  return [
    { id: "safe_arrival", build: () => safeArrivalProvider(input) },
    { id: "plan_rsvp", build: () => planRsvpProvider(input) },
    { id: "plan_starting", build: () => planStartingProvider(input) },
    { id: "event_live", build: () => eventLiveProvider(input) },
    { id: "nearby_muddies", build: () => nearbyMuddiesProvider(input) },
    { id: "event_starting", build: () => eventStartingProvider(input) },
    { id: "birthday", build: () => birthdayProvider(input) },
    { id: "weekend_plans", build: () => weekendPlansProvider(input) },
    { id: "journey", build: () => journeyProvider(input) },
    { id: "journey_complete", build: () => journeyCompleteProvider(input) },
    { id: "buddy_progress", build: () => buddyProgressProvider(input) },
    { id: "achievement", build: () => achievementProvider(input) },
    { id: "suggestions", build: () => suggestionsProvider(input) },
    { id: "upfor_fallback", build: () => upForFallbackProvider() }
  ];
}
