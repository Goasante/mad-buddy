/**
 * Smart Card Engine — the canonical selection rules for Home's single card.
 *
 * Home shows exactly ONE Smart Card, always. It is never a carousel, never a
 * list, and never absent: the last provider is a guaranteed fallback, so
 * `resolveSmartCard` always returns a card. What changes is only the content.
 *
 * This module is pure — no Supabase, no `server-only`, no clock of its own —
 * so the whole priority order is testable without a database. Data loading
 * lives in `smart-card-service.ts`, presentation in `components/journey`.
 */

/**
 * Card identities, in priority order. First match wins.
 *
 * The order is the product rule, encoded once:
 *  - safety outranks everything (a live Safe Arrival is time-critical)
 *  - activation outranks engagement (finish onboarding before we upsell)
 *  - a dated moment outranks an evergreen nudge (a birthday happens once)
 *  - the fallback is last and always applies
 */
export const SMART_CARD_IDS = [
  "safe_arrival",
  "journey",
  "journey_complete",
  "birthday",
  "weekend_plans",
  "nearby_muddies",
  "buddy_progress",
  "achievement",
  "suggestions"
] as const;

export type SmartCardId = (typeof SMART_CARD_IDS)[number];

/** Lower number = higher priority. Derived from the array so the two can't drift. */
export const SMART_CARD_PRIORITY: Record<SmartCardId, number> = Object.fromEntries(
  SMART_CARD_IDS.map((id, index) => [id, index])
) as Record<SmartCardId, number>;

/**
 * Which illustration the card renders. A closed set rather than a free path:
 * the component owns the artwork, so a provider cannot point Home at an
 * arbitrary image or a missing file.
 */
export type SmartCardIllustration =
  | "target"
  | "celebration"
  | "birthday"
  | "calendar"
  | "people"
  | "trophy";

/**
 * Optional progress meter. Providers that have no meaningful progress simply
 * omit it and the card renders without a bar.
 */
export type SmartCardProgress = {
  /** 0–100, already clamped by `smartCardProgress`. */
  percent: number;
  /** Supporting line under the percentage, e.g. "3 steps remaining". */
  label: string;
};

export type SmartCard = {
  id: SmartCardId;
  priority: number;
  illustration: SmartCardIllustration;
  title: string;
  subtitle: string;
  cta: string;
  destination: string;
  progress?: SmartCardProgress;
  /**
   * Wall-clock expiry. A card past this instant is skipped as though its
   * provider had not matched at all — this is what stops a Friday "weekend
   * plans" card leaking into Monday if a page is left open.
   */
  expiresAt?: number;
  /**
   * Whether acknowledging this card retires it permanently. Only cards whose
   * underlying condition never becomes false again need this (see the
   * `smart_card_acknowledgements` migration).
   */
  dismissible?: boolean;
};

/** A provider returns its card when it applies, or null to pass. */
export type SmartCardProvider = {
  id: SmartCardId;
  build: () => SmartCard | null;
};

/** Clamp + round a raw ratio into a card-safe percent. */
export function smartCardProgress(completed: number, total: number, label: string): SmartCardProgress {
  const percent = total > 0 ? Math.round((completed / total) * 100) : 0;
  return { percent: Math.min(100, Math.max(0, percent)), label };
}

/**
 * How far along the Journey a viewer is, as a visual stage.
 *
 * Three stages rather than a continuous ramp: the card has to read as a
 * deliberate state someone can recognise ("I'm well into this"), not as a
 * gradient that shifts imperceptibly with every completed step.
 *
 * Derived from the percent that already exists on the card — there is no
 * second stored value. `smartCardProgress` computes that percent from
 * completed/total at the domain layer, so the stage cannot drift from the
 * meter the viewer is reading right above it.
 */
export type JourneyStage = "early" | "progressing" | "advanced";

/** Inclusive lower bounds. Below the first, the stage is `early`. */
export const JOURNEY_STAGE_THRESHOLDS = { progressing: 40, advanced: 70 } as const;

export function journeyStageForPercent(percent: number): JourneyStage {
  // Guards a NaN percent into the quietest state rather than the loudest:
  // a broken input must never award the advanced treatment.
  if (!Number.isFinite(percent)) return "early";
  if (percent >= JOURNEY_STAGE_THRESHOLDS.advanced) return "advanced";
  if (percent >= JOURNEY_STAGE_THRESHOLDS.progressing) return "progressing";
  return "early";
}

/**
 * Whether a card gets the staged Journey treatment at all.
 *
 * Only the `journey` card progresses. `journey_complete` is a separate,
 * already-earned reward state with its own copy and artwork, and it is NOT
 * folded into the advanced stage — completing the Journey is a different
 * fact from being 70% through it.
 */
export function isStagedJourneyCard(id: SmartCardId): boolean {
  return id === "journey";
}

/**
 * Pick the single card Home renders.
 *
 * Providers are sorted by the canonical priority rather than trusting call
 * order, so registration order in the service can never silently change the
 * product rule. A provider is skipped when it declines (returns null), when
 * its card has expired, or when the user has already acknowledged it.
 *
 * Returns null only if every provider declines — the service registers a
 * fallback that never does, so in practice Home always has a card.
 */
export function resolveSmartCard(
  providers: readonly SmartCardProvider[],
  options: { now: number; acknowledgedIds?: ReadonlySet<string> } = { now: Date.now() }
): SmartCard | null {
  const acknowledged = options.acknowledgedIds ?? new Set<string>();
  const ordered = [...providers].sort(
    (a, b) => SMART_CARD_PRIORITY[a.id] - SMART_CARD_PRIORITY[b.id]
  );

  for (const provider of ordered) {
    if (acknowledged.has(provider.id)) continue;

    const card = provider.build();
    if (!card) continue;
    if (card.expiresAt !== undefined && card.expiresAt <= options.now) continue;

    // Priority is authoritative from the id, not from whatever the provider
    // put in the field — so a provider cannot promote itself.
    return { ...card, priority: SMART_CARD_PRIORITY[card.id] };
  }

  return null;
}

/**
 * Weekend window: Friday 17:00 through end of Sunday, in the viewer's local
 * time. Used by the weekend-plans provider and exported so the tests can
 * assert the boundaries directly.
 */
export function isWeekendPlanningWindow(date: Date): boolean {
  const day = date.getDay();
  if (day === 5) return date.getHours() >= 17;
  return day === 6 || day === 0;
}

/** The instant the weekend window closes: end of the coming Sunday, local time. */
export function weekendWindowExpiry(date: Date): number {
  const end = new Date(date);
  const day = end.getDay();
  // Friday (5) -> +2 days, Saturday (6) -> +1, Sunday (0) -> same day.
  const daysUntilSunday = day === 0 ? 0 : 7 - day;
  end.setDate(end.getDate() + daysUntilSunday);
  end.setHours(23, 59, 59, 999);
  return end.getTime();
}
