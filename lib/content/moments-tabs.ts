import type { VisibleMoment } from "@/lib/content/service";

/**
 * Tab routing and section partitioning for /moments.
 *
 * Pure: no React, no fetching, no Supabase — so the ordering rules, the
 * de-duplication and the legacy URL mapping are all testable directly.
 *
 * Every list this module returns is a re-ordering or partition of feeds the
 * server already authorised. Nothing is filtered IN here, only arranged, so
 * no Moment can reach a section it was not already allowed to appear in.
 */

/** The user-facing tabs. "air" replaces the old "spotlight" wording. */
export const MOMENT_TABS = ["all", "moments", "air"] as const;
export type MomentTab = (typeof MOMENT_TABS)[number];

export const DEFAULT_MOMENT_TAB: MomentTab = "all";

/**
 * Resolve `?tab=` to a real tab.
 *
 * `spotlight` is the legacy identifier — it still appears in older links and
 * in internal code — and maps to Air rather than 404ing or silently falling
 * back to All, so existing links keep working.
 */
export function resolveMomentTab(raw: string | null | undefined): MomentTab {
  const value = (raw ?? "").trim().toLowerCase();
  if (value === "spotlight") return "air";
  return (MOMENT_TABS as readonly string[]).includes(value) ? (value as MomentTab) : DEFAULT_MOMENT_TAB;
}

/** True when a link's tab param is the legacy spelling. */
export function isLegacyTabParam(raw: string | null | undefined): boolean {
  return (raw ?? "").trim().toLowerCase() === "spotlight";
}

/**
 * Order Personal Moments.
 *
 * Priority, per the approved brief:
 *   1. the viewer's own active Moment
 *   2. Close Friends
 *   3. other approved Muddies
 *   4. everything else, by recency
 *
 * Every tier comes from `viewerRelationship`, which the server derives from
 * real friendship data — nothing is inferred client-side, and a Moment with
 * no stated relationship simply sorts last rather than being guessed at.
 */
export function orderPersonalMoments(moments: readonly VisibleMoment[]): VisibleMoment[] {
  const rank = (moment: VisibleMoment): number => {
    if (moment.isAuthor) return 0;
    if (moment.viewerRelationship === "close_friend") return 1;
    if (moment.viewerRelationship === "muddy") return 2;
    return 3;
  };

  return [...moments].sort((a, b) => {
    const byTier = rank(a) - rank(b);
    if (byTier !== 0) return byTier;
    return Date.parse(b.createdAt) - Date.parse(a.createdAt);
  });
}

/** Active Air first, then by recency. */
export function orderAirMoments(air: readonly VisibleMoment[], nowMs = Date.now()): VisibleMoment[] {
  const active = (moment: VisibleMoment) => Date.parse(moment.expiresAt) > nowMs;
  return [...air].sort((a, b) => {
    if (active(a) !== active(b)) return active(a) ? -1 : 1;
    return Date.parse(b.createdAt) - Date.parse(a.createdAt);
  });
}

export type MomentSections = {
  personal: VisibleMoment[];
  air: VisibleMoment[];
  more: VisibleMoment[];
};

/**
 * Split the two authorised feeds into the All tab's three sections.
 *
 * De-duplicated by construction: a Moment id can appear in exactly one
 * section. Air wins over Personal (it is the live surface), and "More" is
 * strictly what neither of the first two took — so scrolling the page can
 * never show the same Moment twice.
 */
export function buildMomentSections(
  moments: readonly VisibleMoment[],
  air: readonly VisibleMoment[],
  { personalLimit = 8, airLimit = 8, moreLimit = 12, nowMs = Date.now() } = {}
): MomentSections {
  const orderedAir = orderAirMoments(air, nowMs);
  const airIds = new Set(orderedAir.map((moment) => moment.id));

  // Personal = everything not already shown as Air.
  const personalPool = orderPersonalMoments(moments.filter((moment) => !airIds.has(moment.id)));
  const personal = personalPool.slice(0, personalLimit);
  const personalIds = new Set(personal.map((moment) => moment.id));

  return {
    personal,
    air: orderedAir.slice(0, airLimit),
    // Whatever Personal could not fit, newest first. Never a repeat.
    more: personalPool
      .filter((moment) => !personalIds.has(moment.id))
      .slice(0, moreLimit)
  };
}

/** Non-Air Moments for the Moments tab, in the same priority order. */
export function momentsTabItems(
  moments: readonly VisibleMoment[],
  air: readonly VisibleMoment[],
  limit = 24
): VisibleMoment[] {
  const airIds = new Set(air.map((moment) => moment.id));
  return orderPersonalMoments(moments.filter((moment) => !airIds.has(moment.id))).slice(0, limit);
}

/** Whether the viewer has no authorised content of any kind. */
export function isMomentsTrulyEmpty(
  moments: readonly VisibleMoment[],
  air: readonly VisibleMoment[]
): boolean {
  return moments.length === 0 && air.length === 0;
}
