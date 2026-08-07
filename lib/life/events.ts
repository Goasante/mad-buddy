/**
 * The Life relationship event contract.
 *
 * Pure: no React, no queries, no clock of its own. It defines WHAT a Life
 * event is and how it is identified; emission and projection live elsewhere.
 *
 * Built on the EXISTING `domain_events` table (append-only, `dedupe_key`,
 * UPDATE/DELETE rejected by trigger) rather than a parallel relationship
 * stream. Two append-only event tables would be two places for an ordering,
 * retention or privacy rule to diverge.
 *
 * Three rules that shape everything here:
 *
 *  1. EVENTS ARE FACTS. "Attended a plan together" is a fact. "You two are
 *     drifting apart" is an inference and belongs in a projection that can be
 *     rebuilt or thrown away — never in an append-only log that cannot.
 *  2. NO MESSAGE CONTENT, EVER. Not in a payload, not in a summary.
 *  3. AI ELIGIBILITY IS EXPLICIT AND DEFAULTS TO FALSE. A future assistant
 *     may only read what was classified as readable at write time.
 */

/** Every Life event carries this resource type in `domain_events`. */
export const LIFE_RESOURCE_TYPE = "relationship" as const;

/**
 * Factual event types.
 *
 * Deliberately small: only events whose source data already exists and whose
 * truth is unambiguous. Speculative types are not declared until something
 * can actually emit them — an event type nothing writes is a promise the
 * projection layer cannot keep.
 *
 * `moment.viewed` is deliberately ABSENT. Per-view events would dwarf every
 * other type combined, carry the highest privacy cost, and answer nothing an
 * assistant needs. Views belong in analytics aggregates.
 */
export const LIFE_EVENT_TYPES = [
  "relationship.created",
  "relationship.ended",
  // Reactivation: two people who ended a friendship become Muddies again.
  // Declared now so the contract is stable, but NOTHING emits it yet —
  // reactivation itself is Phase 3.2B, and an event type nothing writes is a
  // promise the projection cannot keep.
  "relationship.reactivated",
  "relationship.close_friend_added",
  "relationship.close_friend_removed",
  "plan.attended_together",
  "friendship.milestone_reached",
  "reconnect.completed",
  "birthday.reminder_created",
  "relationship.note_created",
  "relationship.note_updated",
  "relationship.note_deleted"
] as const;

export type LifeEventType = (typeof LIFE_EVENT_TYPES)[number];

export function isLifeEventType(value: string): value is LifeEventType {
  return (LIFE_EVENT_TYPES as readonly string[]).includes(value);
}

/**
 * Who may see an event in a projection.
 *
 *  - `shared`   both parties may see it (they were both there).
 *  - `private`  only the owner, even though it names another person. A note
 *               about someone is the author's, not theirs.
 */
export type LifeEventVisibility = "shared" | "private";

/**
 * How long the underlying fact is kept.
 *
 *  - `durable`   survives until account deletion or explicit deletion.
 *  - `ephemeral` a derived convenience that may be expired and rebuilt.
 */
export type LifeEventRetention = "durable" | "ephemeral";

export type LifeEventClassification = {
  visibility: LifeEventVisibility;
  retention: LifeEventRetention;
  /** Whether a future assistant may read this. Defaults false everywhere. */
  aiEligible: boolean;
};

/**
 * Classification per event type.
 *
 * Set at the contract level rather than per call site, so a new emitter
 * cannot accidentally widen who sees something or what AI may read.
 */
export const LIFE_EVENT_CLASSIFICATION: Record<LifeEventType, LifeEventClassification> = {
  // Both parties know they became Muddies.
  "relationship.created": { visibility: "shared", retention: "durable", aiEligible: false },
  "relationship.ended": { visibility: "shared", retention: "durable", aiEligible: false },
  // Shared, like creation: both parties know they are Muddies again.
  "relationship.reactivated": { visibility: "shared", retention: "durable", aiEligible: false },
  // Close-friend status is the OWNER's choice about someone else. Telling the
  // other person they were added — or removed — would leak a private judgement.
  "relationship.close_friend_added": { visibility: "private", retention: "durable", aiEligible: false },
  "relationship.close_friend_removed": { visibility: "private", retention: "durable", aiEligible: false },
  // Both attended; both may remember it.
  "plan.attended_together": { visibility: "shared", retention: "durable", aiEligible: false },
  "friendship.milestone_reached": { visibility: "shared", retention: "durable", aiEligible: false },
  "reconnect.completed": { visibility: "private", retention: "durable", aiEligible: false },
  // A reminder the owner scheduled for themselves.
  "birthday.reminder_created": { visibility: "private", retention: "ephemeral", aiEligible: false },
  // Notes are the author's alone. Never shared, never AI-readable without a
  // separate, explicit consent decision that does not exist yet.
  "relationship.note_created": { visibility: "private", retention: "durable", aiEligible: false },
  "relationship.note_updated": { visibility: "private", retention: "durable", aiEligible: false },
  "relationship.note_deleted": { visibility: "private", retention: "durable", aiEligible: false }
};

/**
 * The canonical id for a relationship, independent of who is asking.
 *
 * Sorted, so the pair (A,B) and (B,A) produce the identical id. Without this
 * a dedupe key would depend on which side acted, and the same fact could be
 * recorded twice.
 */
export function relationshipId(userA: string, userB: string): string {
  return [userA, userB].sort().join(":");
}

/**
 * Stable idempotency key: `<event_type>:<relationship_id>:<natural_key>`.
 *
 * The natural key is what makes the fact unique in time — a plan id, a
 * milestone code, a date. Two retries of one action produce the same key, and
 * the unique index on `dedupe_key` turns the second insert into a no-op.
 */
export function lifeDedupeKey(
  eventType: LifeEventType,
  relationship: string,
  naturalKey: string
): string {
  return `${eventType}:${relationship}:${naturalKey}`;
}

export type LifeEventInput = {
  eventType: LifeEventType;
  /** The user whose action produced the fact. */
  actorId: string;
  /** The other party. */
  subjectId: string;
  /** What makes this fact unique — a plan id, a milestone code, a year. */
  naturalKey: string;
  /**
   * Structured, non-sensitive detail. Ids and codes only: never message
   * content, never free text the user wrote about a person, never location.
   */
  payload?: Record<string, string | number | boolean | null>;
  occurredAt?: string;
};

export type LifeEventRecord = {
  eventType: LifeEventType;
  resourceType: typeof LIFE_RESOURCE_TYPE;
  resourceId: string;
  actorId: string;
  dedupeKey: string;
  payload: Record<string, unknown>;
  occurredAt: string;
  classification: LifeEventClassification;
};

/**
 * Payload keys that must never appear, whatever a caller passes.
 *
 * A denylist is weaker than a schema, but this is defence in depth behind the
 * typed input above: it catches the case where a future emitter spreads an
 * object it did not fully inspect.
 */
const FORBIDDEN_PAYLOAD_KEYS = [
  "message",
  "messageText",
  "text",
  "body",
  "content",
  "note",
  "latitude",
  "longitude",
  "coordinates",
  "email",
  "phone"
];

/**
 * Build the row to append. Pure — the caller performs the insert.
 *
 * Throws on a forbidden payload key rather than silently stripping it: a
 * caller trying to record message content has a bug worth surfacing loudly,
 * not quietly correcting.
 */
export function buildLifeEvent(input: LifeEventInput): LifeEventRecord {
  const relationship = relationshipId(input.actorId, input.subjectId);
  const payload = input.payload ?? {};

  for (const key of Object.keys(payload)) {
    if (FORBIDDEN_PAYLOAD_KEYS.includes(key)) {
      throw new Error(`Life event payload may not contain "${key}".`);
    }
  }

  return {
    eventType: input.eventType,
    resourceType: LIFE_RESOURCE_TYPE,
    resourceId: relationship,
    actorId: input.actorId,
    dedupeKey: lifeDedupeKey(input.eventType, relationship, input.naturalKey),
    // subjectId is recorded so a projection knows the other party without
    // re-parsing the resource id.
    payload: { ...payload, subjectId: input.subjectId },
    occurredAt: input.occurredAt ?? new Date().toISOString(),
    classification: LIFE_EVENT_CLASSIFICATION[input.eventType]
  };
}

/**
 * Whether a viewer may see an event in their own timeline.
 *
 * Shared events are visible to both participants; private events only to the
 * actor. Blocking is handled ABOVE this — a blocked pair produces no timeline
 * at all, rather than a filtered one.
 */
export function canViewLifeEvent(
  event: Pick<LifeEventRecord, "actorId" | "classification"> & { payload: Record<string, unknown> },
  viewerId: string
): boolean {
  if (event.actorId === viewerId) return true;
  if (event.classification.visibility === "private") return false;
  return event.payload.subjectId === viewerId;
}
