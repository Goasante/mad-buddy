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
  "plan_decision",
  "upfor_requests",
  "muddy_request",
  "plan_starting",
  "event_live",
  "upfor_accepted",
  "upfor_momentum",
  "owned_upfor_starting",
  "upfor_active_muddy",
  "event_commitment_starting",
  "plan_chat_decision",
  "event_linkr_ready",
  "nearby_muddies",
  "linkr_mutual_event",
  "linkr_mutual",
  "muddy_birthday",
  "birthday",
  "event_starting",
  "weekend_plans",
  "upfor_scheduled",
  "suggestions",
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

export type SmartCardAction = {
  label: string;
  destination: string;
};

/**
 * A Smart Card is normally navigation. One narrow exception exists when the
 * NEXT job requires an authorised mutation before navigation — opening (or
 * creating) the canonical direct conversation. Providers stay pure: they only
 * describe the intent; the client invokes the existing server authority after
 * the person taps. Home rendering therefore remains read-only.
 */
export type SmartCardPrimaryActionIntent = {
  kind: "open_direct_conversation";
  recipientId: string;
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
  /**
   * Canonical navigation/fallback destination. When primaryActionIntent is
   * present the renderer performs that intent instead; destination remains a
   * truthful fallback for non-JS/source consumers and keeps the card contract
   * backwards-compatible.
   */
  destination: string;
  primaryActionIntent?: SmartCardPrimaryActionIntent;
  secondaryAction?: SmartCardAction;
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
