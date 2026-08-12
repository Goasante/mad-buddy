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

/**
 * The minimum an event must expose to be ranked.
 *
 * `recentGoingCount`/`recentInterestedCount` are RSVPs whose row was created
 * or last changed inside MOMENTUM_WINDOW_MS. They are REQUIRED, not optional:
 * an optional momentum field would silently read as zero for any caller that
 * forgot it, which is the "fake signal wearing a real field's name" problem.
 * A caller that genuinely has no momentum data must pass zeroes deliberately.
 */
export type RankableEvent = {
  id: string;
  startsAtMs: number;
  endsAtMs: number;
  status: string;
  goingCount: number;
  interestedCount: number;
  recentGoingCount: number;
  recentInterestedCount: number;
};

/**
 * Signals the real engine will add, named but NOT scored.
 *
 * Deliberately kept OUT of RankableEvent and out of scoreEvent. Declaring a
 * quality or trust field and multiplying it by zero would let the score claim
 * a signal it does not have; leaving it here documents the intent without
 * pretending. When one becomes real it moves into RankableEvent, gets a
 * weight, and gets its own test.
 */
export type FutureRankingSignals = {
  /** Not implemented: host/venue trust and quality weighting. */
  qualityScore?: number;
  /** Not implemented: suppression for manipulated or brigaded counts. */
  manipulationPenalty?: number;
};

/**
 * Momentum window. RSVPs newer than this count twice -- once in the base
 * demand term and once here -- which is what lets a fast-rising event catch
 * an older one that accumulated the same total slowly.
 */
export const MOMENTUM_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Weights.
 *
 * Going stays ahead of Interested (§27): committing says more than curiosity.
 * But the gap is applied to LOG-SCALED counts, not raw ones, so "twice as
 * strong" no longer means a 2,000-person event is untouchable.
 *
 * Momentum is weighted close to base demand on purpose. Below the log curve,
 * a handful of recent RSVPs on a small new event moves its score more than
 * the same handful moves a large old one -- which is the entire point of
 * ranking "current demand" rather than "lifetime totals".
 */
export const RANKING_WEIGHTS = {
  going: 2,
  interested: 1,
  recentGoing: 1.6,
  recentInterested: 0.8
} as const;

/** Home shows five; the full ranked list is capped at a hundred. */
export const HOME_RANKED_EVENTS_LIMIT = 5;
export const MAX_RANKED_EVENTS = 100;

/**
 * Score differences smaller than this are not differences (§32).
 *
 * Two events whose scores differ in the twelfth decimal place are equally
 * popular; letting float noise decide their order would let them swap ranks
 * between consecutive Home loads. Below this threshold the deterministic
 * tie-breaks take over, so the order is stable.
 */
export const RANKING_SCORE_EPSILON = 1e-9;

/**
 * Diminishing returns on raw popularity (§30).
 *
 * log1p, not the raw count: the difference between 10 and 60 RSVPs is a real
 * signal about demand, while the difference between 2,000 and 2,050 is noise.
 * Linear counts made the second difference as decisive as the first, which is
 * how one large event permanently owned rank 1. Monotonic and deterministic,
 * so it stays explainable -- no ML, no opaque tuning.
 */
function demand(count: number): number {
  return Math.log1p(Math.max(0, count));
}

/**
 * How much an event's proximity to starting is worth (§29).
 *
 * Something happening tonight is a more useful answer to "what's on" than
 * something in three months with more accumulated RSVPs. This is a bounded
 * MULTIPLIER rather than an additive term, so it re-weights demand instead of
 * competing with it -- a dull event happening soon still cannot outrank a
 * genuinely popular one.
 *
 * Deliberately COARSE: buckets, not a continuous function of `now`. A smooth
 * curve would change every score on every request and make the order flicker
 * between two Home loads seconds apart (§32). A bucket boundary moves a
 * ranking at most a few times a day.
 */
export const START_PROXIMITY_BUCKETS = [
  { withinMs: 6 * 60 * 60 * 1000, boost: 1.5 },
  { withinMs: 24 * 60 * 60 * 1000, boost: 1.3 },
  { withinMs: 3 * 24 * 60 * 60 * 1000, boost: 1.15 },
  { withinMs: 7 * 24 * 60 * 60 * 1000, boost: 1.05 }
] as const;

/** Events further out than the last bucket get no boost, never a penalty. */
export const START_PROXIMITY_BASE_BOOST = 1;

export function startProximityBoost(event: RankableEvent, nowMs: number): number {
  // An event already under way is as immediate as it gets.
  const msUntilStart = event.startsAtMs - nowMs;
  if (msUntilStart <= 0) return START_PROXIMITY_BUCKETS[0].boost;
  for (const bucket of START_PROXIMITY_BUCKETS) {
    if (msUntilStart <= bucket.withinMs) return bucket.boost;
  }
  return START_PROXIMITY_BASE_BOOST;
}

/**
 * The score. Explainable in one line:
 *
 *   (log-scaled demand + log-scaled recent demand) x start-proximity boost
 *
 * Every term is real data. Nothing here is a placeholder.
 */
export function scoreEvent(event: RankableEvent, nowMs: number): number {
  const base =
    demand(event.goingCount) * RANKING_WEIGHTS.going +
    demand(event.interestedCount) * RANKING_WEIGHTS.interested;

  const momentum =
    demand(event.recentGoingCount) * RANKING_WEIGHTS.recentGoing +
    demand(event.recentInterestedCount) * RANKING_WEIGHTS.recentInterested;

  return (base + momentum) * startProximityBoost(event, nowMs);
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

  // Scored ONCE per event, not once per comparison: scoreEvent is called
  // O(n log n) times inside a comparator otherwise, and every call would have
  // to re-derive the same boost from the same clock.
  const scored = eligible.map((event) => ({ event, score: scoreEvent(event, nowMs) }));

  const ordered = scored.sort((a, b) => {
    // Scores below this are treated as equal, so imperceptible float
    // differences fall through to the stable tie-breaks instead of reshuffling
    // the deck between two loads seconds apart (§32).
    const scoreDelta = b.score - a.score;
    if (Math.abs(scoreDelta) > RANKING_SCORE_EPSILON) return scoreDelta;
    const startDelta = a.event.startsAtMs - b.event.startsAtMs;
    if (startDelta !== 0) return startDelta;
    return a.event.id.localeCompare(b.event.id);
  });

  return ordered
    .slice(0, Math.max(0, Math.min(limit, MAX_RANKED_EVENTS)))
    .map(({ event, score }, index) => ({ ...event, rank: index + 1, score }));
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
