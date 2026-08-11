/**
 * Event ranking — the pure scoring layer (Ranked Events Discovery).
 *
 * THE ENGINE BOUNDARY. This file is the ONLY place a rank is decided. It is
 * pure: rows in, ordered rows out, no database, no clock of its own. When the
 * dedicated ranking stage lands, it replaces `scoreEvent` and `rankEvents`
 * here and nothing in the projection, the Home module, or the ranked page has
 * to move.
 *
 * WHAT THIS IS NOT. It is not the final algorithm, and it does not pretend to
 * be. It ranks on signals the product genuinely has today -- real RSVP rows
 * counted server-side -- with an explicit, readable formula. No fabricated
 * scores, no invented momentum, no placeholder events. An empty database
 * produces an empty ranking, which is the correct answer rather than a
 * seeded-looking one.
 *
 * FUTURE SIGNALS (deliberately NOT invented here): recent momentum, event
 * recency, trust/quality, anti-manipulation. `RankingSignals` names them as
 * optional inputs so the shape is ready, but scoreEvent ignores anything it
 * cannot honestly compute -- a field that exists but is always zero would be
 * fake ranking wearing a real field's name.
 */

/** The minimum an event must expose to be ranked. */
export type RankableEvent = {
  id: string;
  startsAtMs: number;
  endsAtMs: number;
  status: string;
  goingCount: number;
  interestedCount: number;
};

/**
 * Ranking inputs beyond raw counts. Every one is optional and every one is
 * currently unused: they document the intended shape of the real engine
 * without letting this interim scorer pretend it has them.
 */
export type RankingSignals = {
  /** Reserved: RSVPs gained in a recent window, not total. */
  momentumScore?: number;
  /** Reserved: host/venue trust and quality weighting. */
  qualityScore?: number;
  /** Reserved: suppression for manipulated or brigaded counts. */
  manipulationPenalty?: number;
};

/**
 * Interim weights. Going outweighs Interested because committing is a
 * stronger statement than curiosity -- but Interested still counts, or a new
 * event with real early interest could never surface at all.
 */
export const RANKING_WEIGHTS = { going: 2, interested: 1 } as const;

/** Home shows five; the full ranked list is capped at a hundred. */
export const HOME_RANKED_EVENTS_LIMIT = 5;
export const MAX_RANKED_EVENTS = 100;

export function scoreEvent(event: RankableEvent): number {
  return (
    event.goingCount * RANKING_WEIGHTS.going + event.interestedCount * RANKING_WEIGHTS.interested
  );
}

/**
 * True when an event may appear in a ranking at all.
 *
 * Cancelled and draft events are never ranked, and neither is anything that
 * has already finished -- a ranking of upcoming events that includes last
 * week's is not a ranking, it is a list. `endsAtMs` is the boundary, not
 * `startsAtMs`: an event running right now has not passed.
 */
export function isRankableEvent(event: RankableEvent, nowMs: number): boolean {
  if (event.status === "cancelled" || event.status === "draft" || event.status === "ended") {
    return false;
  }
  return event.endsAtMs > nowMs;
}

/**
 * Orders events best-first and assigns dense ranks starting at 1.
 *
 * TOTAL ORDER, DELIBERATELY. Score first, then soonest start, then id. The
 * last tie-break looks pedantic but is what makes the order STABLE: without
 * it, two events with equal scores and identical start times could swap
 * places between the Home load and the full-list load, and the same event
 * would hold two different ranks on two screens. Ranks are also strictly
 * sequential -- equal scores do not share a rank, because "#3, #3, #5" in a
 * five-panel accordion reads as a bug.
 */
export function rankEvents<T extends RankableEvent>(
  events: T[],
  nowMs: number,
  limit: number = MAX_RANKED_EVENTS
): Array<T & { rank: number; score: number }> {
  const eligible = events.filter((event) => isRankableEvent(event, nowMs));

  const ordered = [...eligible].sort((a, b) => {
    const scoreDelta = scoreEvent(b) - scoreEvent(a);
    if (scoreDelta !== 0) return scoreDelta;
    const startDelta = a.startsAtMs - b.startsAtMs;
    if (startDelta !== 0) return startDelta;
    return a.id.localeCompare(b.id);
  });

  return ordered
    .slice(0, Math.max(0, Math.min(limit, MAX_RANKED_EVENTS)))
    .map((event, index) => ({ ...event, rank: index + 1, score: scoreEvent(event) }));
}

/**
 * The left-to-right panel order for the Home accordion: #4 #3 #1 #2 #5.
 *
 * Puts the top-ranked event at the optical centre with its runners-up either
 * side, so the eye lands on #1 rather than on the left edge. Returns whatever
 * it can when fewer than five events exist -- a three-event ranking still
 * centres #1 rather than collapsing to plain order.
 */
export const ACCORDION_RANK_ORDER = [4, 3, 1, 2, 5] as const;

export function arrangeForAccordion<T extends { rank: number }>(ranked: T[]): T[] {
  const byRank = new Map(ranked.map((item) => [item.rank, item]));
  return ACCORDION_RANK_ORDER.map((rank) => byRank.get(rank)).filter(
    (item): item is T => item !== undefined
  );
}

/** Index of rank #1 within the arranged array, so the accordion opens on it. */
export function activeIndexForAccordion<T extends { rank: number }>(arranged: T[]): number {
  const index = arranged.findIndex((item) => item.rank === 1);
  return index === -1 ? 0 : index;
}
