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
  "muddy_request",
  "meetup_starting",
  "event_live",
  "event_commitment_starting",
  "event_linkr_ready",
  "nearby_muddies",
  "meetup_upcoming",
  "event_starting",
  "linkr_mutual_event",
  "linkr_mutual",
  "muddy_birthday",
  "birthday",
  "suggestions",
  "profile_blocking",
  "journey_complete",
  "achievement",
  "journey",
  "buddy_progress",
  "meetup_fallback"
] as const;

export type SmartCardId = (typeof SMART_CARD_IDS)[number];

/**
 * Ordinary card families the product intentionally allows a person to retire
 * permanently from Home.
 *
 * Keep this narrower than SMART_CARD_IDS. Safety, invitations, live
 * coordination and opportunities are current facts; a forged acknowledgement
 * must never be able to hide them forever. Repeatable achievements use their
 * per-instance `achievement:<code>` key instead of the family id.
 */
export const DISMISSIBLE_SMART_CARD_IDS = ["journey_complete"] as const satisfies readonly SmartCardId[];

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
 * What the compact metadata row MEANS.
 *
 * The renderer needs this because "Where should we eat?", "Waiting on them"
 * and "East Legon" are all plain strings but they are not the same kind of
 * information. Treating every meta line as a calendar fact made the heartbeat
 * visually misleading even when its words were correct.
 */
export type SmartCardMetaKind = "time" | "location" | "decision" | "status";

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
  /** Identity already authorized for this viewer; never inferred from artwork. */
  person?: { displayName: string; avatarUrl?: string | null };
  secondaryAction?: SmartCardAction;
  /**
   * When present, the PRIMARY action runs this instead of navigating to
   * `destination`. `destination` remains set as the honest fallback surface, so
   * a card is never actionless if the intent cannot be completed.
   */
  primaryIntent?: SmartCardActionIntent;
  /** Optional truthful context line such as "2 Muddies might join". */
  socialProof?: string;
  /** Optional privacy-safe metadata line such as "East Legon" or "Waiting on them". */
  meta?: string;
  /** Semantic meaning of `meta`, so the UI can pair it with the right icon. */
  metaKind?: SmartCardMetaKind;
  /** Optional real/curated media for V2 visual treatment. */
  media?: SmartCardMedia;
  progress?: SmartCardProgress;
  expiresAt?: number;
  dismissible?: boolean;
  /**
   * Optional per-instance retirement key.
   *
   * Most dismissible cards are one-off states and can use their id. Repeatable
   * families such as achievements need a stable instance identity or opening
   * one would permanently silence every future card in that family.
   */
  acknowledgementKey?: string;
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
    if (excluded.has(provider.id)) continue;
    const card = provider.build();
    if (!card) continue;
    /*
     * Build first, then check acknowledgement. A repeatable family may have a
     * per-instance key (for example achievement:first_wave) that cannot be
     * known from provider.id alone.
     */
    const acknowledgementKey = card.acknowledgementKey ?? card.id;
    /*
     * Acknowledgements are presentation state, never authority. Even if an old
     * row or a forged action managed to store "safe_arrival" or "plan_rsvp",
     * a non-dismissible live fact must still render.
     */
    if (card.dismissible && acknowledged.has(acknowledgementKey)) continue;
    // The Meet Up fallback is not permanently dismissible. A recent impression
    // suppresses it only for the service-level cooldown window.
    if (card.id === "meetup_fallback" && acknowledged.has("meetup_fallback")) continue;
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
