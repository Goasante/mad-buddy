/**
 * The Relationship Timeline projection.
 *
 * Pure: it is handed rows already read from `domain_events` and returns what
 * ONE viewer may see. Reading and authorising live in the server loader; the
 * ordering, filtering and pagination rules live here so they are testable
 * without a database.
 *
 * Rebuildable by construction: the timeline is a function of the event log
 * and nothing else. There is no stored state to drift, so a projection bug is
 * fixed by changing this file and re-rendering — never by data repair.
 *
 * Three behaviours the approved decisions pin down:
 *
 *  - UNFRIENDING DOES NOT ERASE HISTORY. `friendships.ended_at` already keeps
 *    the record, and losing every shared memory because a friendship lapsed
 *    would make Life feel punitive. The timeline survives, privately.
 *  - BLOCKING HIDES EVERYTHING, BOTH DIRECTIONS. Not filtered — absent. A
 *    partially-filtered timeline still tells you the other person exists and
 *    did things.
 *  - PRIVATE EVENTS STAY WITH THEIR OWNER. Adding someone as a Close Friend
 *    is a private judgement; the other party must never learn of it.
 */

import {
  canViewLifeEvent,
  isLifeEventType,
  LIFE_EVENT_CLASSIFICATION,
  type LifeEventType
} from "@/lib/life/events";

/** A row as read from `domain_events`. */
export type TimelineSourceRow = {
  eventType: string;
  actorId: string;
  occurredAt: string;
  payload: Record<string, unknown>;
};

/** One entry in a viewer's timeline. */
export type TimelineEntry = {
  eventType: LifeEventType;
  occurredAtMs: number;
  /** True when the viewer performed the action. */
  byViewer: boolean;
  /** Structured detail only — never message content or free text. */
  payload: Record<string, unknown>;
};

export type TimelineOptions = {
  /** Entries per page. */
  limit?: number;
  /** Return only entries strictly older than this, for pagination. */
  beforeMs?: number;
  /**
   * The viewer's own cut-off from `life_timeline_resets`.
   *
   * Events at or before this instant are hidden from THIS user only. The
   * events themselves are untouched and the other participant still sees
   * them — clearing a timeline is a private preference, not a deletion.
   *
   * A timestamp rather than a flag, so events arriving after the reset show
   * up normally instead of the timeline staying empty forever.
   */
  hiddenBeforeMs?: number | null;
};

export const TIMELINE_PAGE_SIZE = 25;

export type TimelineResult = {
  entries: TimelineEntry[];
  /** Cursor for the next page, or null at the end. */
  nextBeforeMs: number | null;
};

/**
 * Build one viewer's timeline.
 *
 * `blocked` is a hard gate rather than a filter: a blocked relationship
 * returns nothing at all, in either direction.
 */
export function buildTimeline(
  rows: readonly TimelineSourceRow[],
  viewerId: string,
  {
    blocked = false,
    limit = TIMELINE_PAGE_SIZE,
    beforeMs,
    hiddenBeforeMs = null
  }: TimelineOptions & { blocked?: boolean } = {}
): TimelineResult {
  // Blocking overrides everything, including a reset: nothing is returned in
  // either direction.
  if (blocked) return { entries: [], nextBeforeMs: null };

  const visible = rows
    .filter((row): row is TimelineSourceRow & { eventType: LifeEventType } => isLifeEventType(row.eventType))
    .filter((row) =>
      canViewLifeEvent(
        {
          actorId: row.actorId,
          classification: LIFE_EVENT_CLASSIFICATION[row.eventType],
          payload: row.payload
        },
        viewerId
      )
    )
    .map((row) => ({
      eventType: row.eventType,
      occurredAtMs: Date.parse(row.occurredAt),
      byViewer: row.actorId === viewerId,
      payload: row.payload
    }))
    // Unparseable timestamps are dropped rather than sorted to the epoch,
    // where they would masquerade as the oldest history.
    .filter((entry) => Number.isFinite(entry.occurredAtMs))
    // The viewer's own cut-off. Inclusive, so clearing "now" hides everything
    // recorded up to this instant and nothing after it.
    .filter((entry) => hiddenBeforeMs === null || entry.occurredAtMs > hiddenBeforeMs)
    .sort((a, b) => b.occurredAtMs - a.occurredAtMs);

  const page = (beforeMs === undefined ? visible : visible.filter((entry) => entry.occurredAtMs < beforeMs)).slice(
    0,
    limit
  );

  // A full page implies there may be more; a short page is definitively the end.
  const nextBeforeMs = page.length === limit ? (page[page.length - 1]?.occurredAtMs ?? null) : null;

  return { entries: page, nextBeforeMs };
}

/**
 * Facts a timeline yields for other Life features.
 *
 * Counts and dates only — deliberately not a summary, a score or a
 * characterisation. This is what the reconnect engine and milestones consume.
 */
export type TimelineFacts = {
  createdAtMs: number | null;
  /**
   * When the relationship ended, or null if it is currently active.
   *
   * Null once a `relationship.reactivated` follows the last `ended` — the
   * question this answers is "are they currently ended", not "did they ever
   * end". `reactivatedAtMs` keeps the fact that it happened.
   */
  endedAtMs: number | null;
  /** The most recent reactivation, if the pair ever came back. */
  reactivatedAtMs: number | null;
  lastInteractionAtMs: number | null;
  interactionCount: number;
  plansAttendedTogether: number;
  reconnectsCompleted: number;
};

/** Event types that count as a real, shared interaction. */
const INTERACTION_EVENTS: LifeEventType[] = ["plan.attended_together", "reconnect.completed"];

export function timelineFacts(entries: readonly TimelineEntry[]): TimelineFacts {
  let createdAtMs: number | null = null;
  let endedAtMs: number | null = null;
  let reactivatedAtMs: number | null = null;
  let lastInteractionAtMs: number | null = null;
  let interactionCount = 0;
  let plansAttendedTogether = 0;
  let reconnectsCompleted = 0;

  for (const entry of entries) {
    if (entry.eventType === "relationship.created") {
      createdAtMs = createdAtMs === null ? entry.occurredAtMs : Math.min(createdAtMs, entry.occurredAtMs);
    }
    if (entry.eventType === "relationship.ended") {
      endedAtMs = endedAtMs === null ? entry.occurredAtMs : Math.max(endedAtMs, entry.occurredAtMs);
    }
    if (entry.eventType === "relationship.reactivated") {
      reactivatedAtMs =
        reactivatedAtMs === null ? entry.occurredAtMs : Math.max(reactivatedAtMs, entry.occurredAtMs);
    }
    if (entry.eventType === "plan.attended_together") plansAttendedTogether += 1;
    if (entry.eventType === "reconnect.completed") reconnectsCompleted += 1;

    if (INTERACTION_EVENTS.includes(entry.eventType)) {
      interactionCount += 1;
      lastInteractionAtMs =
        lastInteractionAtMs === null ? entry.occurredAtMs : Math.max(lastInteractionAtMs, entry.occurredAtMs);
    }
  }

  // A reactivation after the last ending means the pair is active again. Left
  // as-is when the ending is the later event: ended → reactivated → ended is a
  // relationship that ended.
  const currentlyEndedAtMs =
    endedAtMs !== null && reactivatedAtMs !== null && reactivatedAtMs > endedAtMs ? null : endedAtMs;

  return {
    createdAtMs,
    endedAtMs: currentlyEndedAtMs,
    reactivatedAtMs,
    lastInteractionAtMs,
    interactionCount,
    plansAttendedTogether,
    reconnectsCompleted
  };
}
