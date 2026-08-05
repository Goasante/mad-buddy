/**
 * The ten Smart Card providers.
 *
 * Every provider is a pure function of `SmartCardInput` — no queries, no
 * clock, no randomness — so the entire priority order can be tested by
 * building an input and asserting which card wins. Loading that input is the
 * service's job.
 *
 * A provider returns null to decline. Declining is normal: on any given day
 * most providers decline and one wins.
 */

import type { BuddyScoreData } from "@/lib/engagement/buddy-score-service";
import type { JourneyData } from "@/lib/journey/journey";
import {
  isWeekendPlanningWindow,
  smartCardProgress,
  weekendWindowExpiry,
  type SmartCard,
  type SmartCardProvider
} from "@/lib/smart-card/smart-card";

export type SmartCardInput = {
  now: Date;
  /** Null when the Journey could not be loaded — providers must not assume it. */
  journey: JourneyData | null;
  /** A live Safe Arrival the viewer is travelling on, if any. */
  safeArrival: { travelling: boolean; watcherCount: number } | null;
  /** Viewer's own birthday state. Never another user's. */
  birthday: { birthdayToday: boolean; birthdayTomorrow: boolean } | null;
  /** Count of plans starting within the weekend window. */
  weekendPlanCount: number;
  /** Muddies currently nearby. */
  nearbyCount: number;
  /** Whether the viewer already has effective Buddy Plus or Pro. */
  hasPremium: boolean;
  buddyScore: Pick<BuddyScoreData, "nextLevel" | "pointsToNext" | "progressPercent"> | null;
  /** Most recently earned achievement not yet acknowledged. */
  recentAchievement: { title: string } | null;
  /** Muddy suggestions available to the viewer. */
  suggestionCount: number;
};

/** 1. Safe Arrival — a live journey outranks every other card. */
function safeArrivalProvider(input: SmartCardInput): SmartCard | null {
  if (!input.safeArrival?.travelling) return null;
  const { watcherCount } = input.safeArrival;
  return {
    id: "safe_arrival",
    priority: 0,
    illustration: "people",
    title: "You're on a journey",
    subtitle:
      watcherCount > 0
        ? `${watcherCount} ${watcherCount === 1 ? "Muddy is" : "Muddies are"} checking on you. Confirm when you arrive.`
        : "Confirm your arrival so your circle knows you're safe.",
    cta: "Confirm Arrival",
    destination: "/safe-arrival"
  };
}

/** 2. Journey — the activation card, shown until every step is done. */
function journeyProvider(input: SmartCardInput): SmartCard | null {
  const journey = input.journey;
  if (!journey?.currentStep) return null;

  const remaining = Math.max(0, journey.totalCount - journey.completedCount);
  return {
    id: "journey",
    priority: 1,
    illustration: "target",
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

/**
 * 3. Journey Complete — the reward state.
 *
 * Journey completion is derived, so this condition is true forever once
 * earned. That is exactly why the card is dismissible: acknowledging it is
 * what retires it, and the engine then permanently advances to whatever
 * applies next. A higher-priority card still overrides it in the meantime
 * without consuming the acknowledgement.
 */
function journeyCompleteProvider(input: SmartCardInput): SmartCard | null {
  const journey = input.journey;
  if (!journey || journey.totalCount === 0) return null;
  if (journey.completedCount < journey.totalCount) return null;

  return {
    id: "journey_complete",
    priority: 2,
    illustration: "celebration",
    title: "Journey complete",
    subtitle: "You've unlocked everything Mad Buddy has to offer. Here's how far you've come.",
    cta: "View My Progress",
    destination: "/buddy-score",
    progress: smartCardProgress(journey.totalCount, journey.totalCount, "All steps complete"),
    dismissible: true
  };
}

/** 4. Birthday — a dated moment, so it outranks every evergreen nudge. */
function birthdayProvider(input: SmartCardInput): SmartCard | null {
  if (!input.birthday) return null;
  const { birthdayToday, birthdayTomorrow } = input.birthday;
  if (!birthdayToday && !birthdayTomorrow) return null;

  // Expires at the end of the birthday itself.
  const expiry = new Date(input.now);
  if (birthdayTomorrow) expiry.setDate(expiry.getDate() + 1);
  expiry.setHours(23, 59, 59, 999);

  return {
    id: "birthday",
    priority: 3,
    illustration: "birthday",
    title: birthdayToday ? "Happy birthday!" : "Your birthday is tomorrow",
    subtitle: birthdayToday
      ? "Your Muddies can celebrate with you today."
      : "Let your Muddies know how you'd like to celebrate.",
    cta: birthdayToday ? "See Your Day" : "Plan Something",
    destination: birthdayToday ? "/profile" : "/plans",
    expiresAt: expiry.getTime()
  };
}

/** 5. Weekend Plans — Friday evening through Sunday. */
function weekendPlansProvider(input: SmartCardInput): SmartCard | null {
  if (!isWeekendPlanningWindow(input.now)) return null;

  const count = input.weekendPlanCount;
  return {
    id: "weekend_plans",
    priority: 4,
    illustration: "calendar",
    title: count > 0 ? "Your weekend is filling up" : "Make weekend plans",
    subtitle:
      count > 0
        ? `You have ${count} ${count === 1 ? "plan" : "plans"} coming up. Keep the momentum going.`
        : "Nothing on yet. See who's free and put something together.",
    cta: count > 0 ? "View Plans" : "Create a Plan",
    destination: "/plans",
    expiresAt: weekendWindowExpiry(input.now)
  };
}

/** 6. Nearby Muddies — someone is actually around right now. */
function nearbyMuddiesProvider(input: SmartCardInput): SmartCard | null {
  if (input.nearbyCount <= 0) return null;

  const count = input.nearbyCount;
  return {
    id: "nearby_muddies",
    priority: 5,
    illustration: "people",
    title: count === 1 ? "A Muddy is nearby" : `${count} Muddies are nearby`,
    subtitle: "Say hello while you're both in the area.",
    cta: "See Who's Close",
    destination: "/friends"
  };
}

/** 7. Membership — only for users who don't already have it. */
function membershipProvider(input: SmartCardInput): SmartCard | null {
  if (input.hasPremium) return null;

  return {
    id: "membership",
    priority: 6,
    illustration: "premium",
    title: "Unlock Buddy Plus",
    subtitle: "Custom glow, richer presence, and more ways to stay close to your circle.",
    cta: "See What's Included",
    destination: "/billing"
  };
}

/** 8. Buddy Progress — the next reputation level. */
function buddyProgressProvider(input: SmartCardInput): SmartCard | null {
  const score = input.buddyScore;
  // `nextLevel` is null at the top level, and `pointsToNext` is 0 there too —
  // either way there is no "next" to nudge toward.
  if (!score?.nextLevel || score.pointsToNext <= 0) return null;

  return {
    id: "buddy_progress",
    priority: 7,
    illustration: "trophy",
    title: `${score.pointsToNext} points to ${score.nextLevel.label}`,
    subtitle: "Keep showing up for your Muddies and your Buddy Score keeps climbing.",
    cta: "View My Progress",
    destination: "/buddy-score",
    progress: {
      percent: Math.min(100, Math.max(0, Math.round(score.progressPercent))),
      label: `Next: ${score.nextLevel.label}`
    }
  };
}

/** 9. Achievement — a recently earned badge worth surfacing once. */
function achievementProvider(input: SmartCardInput): SmartCard | null {
  if (!input.recentAchievement) return null;

  return {
    id: "achievement",
    priority: 8,
    illustration: "trophy",
    title: input.recentAchievement.title,
    subtitle: "You earned a new achievement. See it alongside everything else you've unlocked.",
    cta: "View Achievements",
    destination: "/buddy-score",
    dismissible: true
  };
}

/**
 * 10. Suggestions — the guaranteed fallback.
 *
 * This provider never declines. It is what makes "there is always exactly one
 * Smart Card" true, so its copy has to work for a user with no suggestions at
 * all as well as one with plenty.
 */
function suggestionsProvider(input: SmartCardInput): SmartCard {
  const count = input.suggestionCount;
  return {
    id: "suggestions",
    priority: 9,
    illustration: "people",
    title: count > 0 ? "People you may know" : "Grow your circle",
    subtitle:
      count > 0
        ? `${count} ${count === 1 ? "person" : "people"} you might already know are on Mad Buddy.`
        : "Mad Buddy works best with your real circle. Find the people you already know.",
    cta: count > 0 ? "See Suggestions" : "Find Muddies",
    destination: "/friends"
  };
}

/**
 * Build the full provider list for a viewer. Registration order here is
 * irrelevant — `resolveSmartCard` sorts by the canonical priority — but it is
 * kept in priority order for readability.
 */
export function smartCardProviders(input: SmartCardInput): readonly SmartCardProvider[] {
  return [
    { id: "safe_arrival", build: () => safeArrivalProvider(input) },
    { id: "journey", build: () => journeyProvider(input) },
    { id: "journey_complete", build: () => journeyCompleteProvider(input) },
    { id: "birthday", build: () => birthdayProvider(input) },
    { id: "weekend_plans", build: () => weekendPlansProvider(input) },
    { id: "nearby_muddies", build: () => nearbyMuddiesProvider(input) },
    { id: "membership", build: () => membershipProvider(input) },
    { id: "buddy_progress", build: () => buddyProgressProvider(input) },
    { id: "achievement", build: () => achievementProvider(input) },
    { id: "suggestions", build: () => suggestionsProvider(input) }
  ];
}
