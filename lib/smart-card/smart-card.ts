/**
 * Smart Card Engine — canonical selection rules for Home's single adaptive card.
 *
 * Home renders exactly ONE Smart Card. Providers are pure and deterministic;
 * data loading lives in smart-card-service.ts and presentation lives in
 * components/journey/smart-card.tsx.
 *
 * The product-wide approved state catalog lives in catalog.ts. SMART_CARD_IDS
 * below is narrower on purpose: it contains only states whose provider is
 * actually wired today. This prevents a planned state from pretending to be
 * implemented merely because its name exists in a roadmap.
 */

export const SMART_CARD_IDS = [
  "safe_arrival",
  "plan_rsvp",
  /* Tier 1, immediately after the invitation itself: a Plan you have already
     joined asking which venue -- an answer only you can give, and one the rest
     of the group is blocked on. It sits below plan_rsvp because answering
     whether you are coming comes before helping decide the details. */
  "plan_decision",
  /* Tier 1 alongside plan_rsvp: people are waiting on the owner's answer, and
     an unanswered join request is the same shape of obligation as an
     unanswered Plan invitation. It sits second because a Plan has a time
     attached and a request does not. */
  "upfor_requests",
  /* Tier 1: somebody asked to connect and is waiting. Last of the tier-1 group
     because a Plan and an UpFor both carry a time pressure a friend request
     does not -- but still above everything that is merely happening. */
  "muddy_request",
  "plan_starting",
  "event_live",
  /* Tier 2. `upfor_accepted` leads the group: somebody saying yes to you is the
     payoff UpFor exists to produce, and it is the only one of these the viewer
     has already been waiting on. */
  "upfor_accepted",
  "upfor_momentum",
  "owned_upfor_starting",
  "upfor_active_muddy",
  /* Hosting or going, starting soon: a commitment with a time attached, so it
     ranks with the other tier-2 states rather than with Events the viewer only
     bookmarked. */
  "event_commitment_starting",
  /* Tier 2. A decision inside a Plan Chat is coordination happening NOW, and
     unlike plan_decision it has no deadline of its own -- it ranks here because
     the conversation is live, not because a clock is running. */
  "plan_chat_decision",
  /* Tier 2. Being checked in somewhere is the most current thing about this
     viewer, and the offer only exists while they are still there. Below the
     live commitments above it: what you are already committed to outranks an
     optional extra at the place you have arrived. */
  "event_linkr_ready",
  "nearby_muddies",
  /* Tier 3: relationship momentum. All are about a specific person, which is
     why they outrank the tier-4 opportunities below.
     The Event variant leads: a shared Event gives the pair something to open
     with, so it is strictly more useful than the same card without one. */
  "linkr_mutual_event",
  "linkr_mutual",
  /* Someone else's birthday before the viewer's own: a moment that needs an
     action from them outranks one that simply belongs to them. */
  "muddy_birthday",
  "birthday",
  "event_starting",
  "weekend_plans",
  "upfor_scheduled",
  /* Cold-start people help outranks Journey deliberately.
     For a viewer with no Muddies these two ask for the same thing -- Journey's
     current step IS "Add your first Muddy" -- but suggestions name real people
     already on Mad Buddy while Journey offers generic progression. Naming
     someone you might know is relationship help (tier 3); a progress meter is
     growth (tier 5). The provider yields as soon as muddyCount > 0, so this
     ordering only ever applies to a genuinely empty circle. */
  "suggestions",
  /* Tier 5, and ahead of Journey deliberately. Both are progression, but this
     one names a feature the viewer has already SWITCHED ON and cannot use --
     a door they opened that will not let them through -- whereas Journey
     offers the next generic step. A specific broken thing beats a general
     suggestion. */
  "profile_blocking",
  "journey",
  "journey_complete",
  "buddy_progress",
  "achievement",
  "upfor_fallback"
] as const;

export type SmartCardId = (typeof SMART_CARD_IDS)[number];

/** Lower number = higher priority. Derived from one ordered list. */
export const SMART_CARD_PRIORITY: Record<SmartCardId, number> = Object.fromEntries(
  SMART_CARD_IDS.map((id, index) => [id, index])
) as Record<SmartCardId, number>;

export type SmartCardIllustration =
  | "target"
  | "celebration"
  | "birthday"
  | "calendar"
  | "people"
  | "trophy";

export type SmartCardProgress = {
  percent: number;
  label: string;
};

/**
 * V2 presentation fields are additive so existing states keep rendering while
 * richer providers are introduced. `cta` + `destination` remain the primary
 * action authority for the current renderer. `secondaryAction` is reserved for
 * the next renderer tranche where states such as Nearby (Say hi / Make a Plan)
 * and UpFor (I'm interested / Details) can expose a second honest action.
 */
export type SmartCardAction = {
  label: string;
  destination: string;
};

/**
 * A primary action that needs an AUTHORIZED SERVER ACTION before it can go
 * anywhere, rather than a destination that is already known.
 *
 * WHY THIS EXISTS, and why it is not a general framework. The closeout for V2
 * said "every Smart Card action is a link". That was too rigid: it is true of
 * navigation, and false the moment the next step is "open the conversation with
 * this person", because the canonical conversation may not exist yet and only
 * the server may decide whether the pair is allowed one at all.
 *
 * The corrected principle: a Smart Card action uses the CANONICAL OWNER of the
 * next product step. Navigation stays a link when navigation is enough; a
 * server action is used when opening the next surface requires an authorized
 * mutation. Everything else on the card remains a link.
 *
 * The intent carries an id and nothing else. It grants no permission and
 * asserts no eligibility -- `openDirectConversationAction` re-checks blocks,
 * relationship and rate limits at click time, and Home never pre-creates a
 * conversation while rendering.
 */
export type SmartCardActionIntent = {
  kind: "open_direct_conversation";
  /** Whose conversation to open. Authorization is decided server-side. */
  targetUserId: string;
};

export type SmartCardMedia = {
  /** A signed/user-safe URL or a curated in-app asset path. */
  url: string;
  alt: string;
  focalX?: number | null;
  focalY?: number | null;
};

export type SmartCard = {
  id: SmartCardId;
  priority: number;
  illustration: SmartCardIllustration;
  /** Small context label such as NEEDS YOUR RESPONSE or HAPPENING NOW. */
  eyebrow?: string;
  title: string;
  subtitle: string;
  cta: string;
  destination: string;
  secondaryAction?: SmartCardAction;
  /**
   * When present, the PRIMARY action runs this instead of navigating to
   * `destination`. `destination` remains set as the honest fallback surface, so
   * a card is never actionless if the intent cannot be completed.
   */
  primaryIntent?: SmartCardActionIntent;
  /** Optional truthful context line such as "2 Muddies might join". */
  socialProof?: string;
  /** Optional privacy-safe metadata line such as "Close By · This evening". */
  meta?: string;
  /** Optional real/curated media for V2 visual treatment. */
  media?: SmartCardMedia;
  progress?: SmartCardProgress;
  expiresAt?: number;
  dismissible?: boolean;
};

export type SmartCardProvider = {
  id: SmartCardId;
  build: () => SmartCard | null;
};

export function smartCardProgress(completed: number, total: number, label: string): SmartCardProgress {
  const percent = total > 0 ? Math.round((completed / total) * 100) : 0;
  return { percent: Math.min(100, Math.max(0, percent)), label };
}

export type JourneyStage = "early" | "progressing" | "advanced";
export const JOURNEY_STAGE_THRESHOLDS = { progressing: 40, advanced: 70 } as const;

export function journeyStageForPercent(percent: number): JourneyStage {
  if (!Number.isFinite(percent)) return "early";
  if (percent >= JOURNEY_STAGE_THRESHOLDS.advanced) return "advanced";
  if (percent >= JOURNEY_STAGE_THRESHOLDS.progressing) return "progressing";
  return "early";
}

export function isStagedJourneyCard(id: SmartCardId): boolean {
  return id === "journey";
}

/**
 * First applicable provider wins after canonical priority sorting.
 *
 * `excludedIds` lets a SURFACE say which states it does not own. Home passes
 * the ones NearbyHero and the Activation card own, so that when (say)
 * `nearby_muddies` ranks highest the engine keeps looking and returns the best
 * Plan or Event instead. Filtering afterwards in the client would resolve a
 * card and then silently render nothing -- Home would go blank precisely when
 * it had something useful to say.
 */
export function resolveSmartCard(
  providers: readonly SmartCardProvider[],
  options: {
    now: number;
    acknowledgedIds?: ReadonlySet<string>;
    excludedIds?: ReadonlySet<string> | readonly string[];
  } = { now: Date.now() }
): SmartCard | null {
  const acknowledged = options.acknowledgedIds ?? new Set<string>();
  const excluded =
    options.excludedIds instanceof Set
      ? options.excludedIds
      : new Set<string>(options.excludedIds ?? []);
  const ordered = [...providers].sort(
    (a, b) => SMART_CARD_PRIORITY[a.id] - SMART_CARD_PRIORITY[b.id]
  );

  for (const provider of ordered) {
    if (acknowledged.has(provider.id)) continue;
    if (excluded.has(provider.id)) continue;
    const card = provider.build();
    if (!card) continue;
    if (card.expiresAt !== undefined && card.expiresAt <= options.now) continue;
    return { ...card, priority: SMART_CARD_PRIORITY[card.id] };
  }

  return null;
}

export function isWeekendPlanningWindow(date: Date): boolean {
  const day = date.getDay();
  if (day === 5) return date.getHours() >= 17;
  return day === 6 || day === 0;
}

export function weekendWindowExpiry(date: Date): number {
  const end = new Date(date);
  const day = end.getDay();
  const daysUntilSunday = day === 0 ? 0 : 7 - day;
  end.setDate(end.getDate() + daysUntilSunday);
  end.setHours(23, 59, 59, 999);
  return end.getTime();
}
