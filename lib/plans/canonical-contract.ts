export type PlanServiceCode =
  | "validation"
  | "not_found"
  | "not_authorized"
  | "ineligible"
  | "limit_reached"
  | "closed"
  | "deadline_passed"
  | "conflict"
  | "rate_limited"
  | "server_unavailable";

export type CanonicalPlanError = {
  ok: false;
  message: string;
  code: PlanServiceCode;
};

const POSTGRES_INT_MAX = 2_147_483_647;

/**
 * The largest participant count `create_plan_lifecycle` will accept.
 *
 * The RPC raises PLAN_PARTICIPANT_LIMIT_INVALID for anything above this, and
 * stores the value it is given as the plan's own `max_participants`. It is a
 * server-side safety ceiling on the size of one plan, NOT a paywall.
 */
export const CANONICAL_MAX_PLAN_PARTICIPANTS = 500;

/** Converts product-level Infinity into a server-controlled PostgreSQL int. */
export function toCanonicalPlanLimit(value: number): number {
  return Number.isFinite(value) ? Math.trunc(value) : POSTGRES_INT_MAX;
}

/**
 * The participant limit, in the range the canonical RPC actually accepts.
 *
 * WHY THIS EXISTS. `max_plan_participants` is deliberately UNLIMITED -- a cap
 * would mean paying to invite the eleventh friend to something you organised.
 * `toCanonicalPlanLimit` turned that Infinity into POSTGRES_INT_MAX, and the
 * RPC rejects anything over 500, so EVERY plan creation failed with
 * "Check the plan details and try again" -- direct and UpFor conversion alike.
 *
 * Clamping here keeps the entitlement unlimited (nobody is being sold a bigger
 * plan) while sending the RPC a value inside its own contract. A finite tier
 * value below the ceiling is passed through untouched.
 */
export function toCanonicalParticipantLimit(value: number): number {
  return Math.min(toCanonicalPlanLimit(value), CANONICAL_MAX_PLAN_PARTICIPANTS);
}

const RPC_ERROR_CODE: Record<string, PlanServiceCode> = {
  PLAN_ACTOR_REQUIRED: "not_authorized",
  PLAN_REQUEST_KEY_INVALID: "validation",
  PLAN_TITLE_INVALID: "validation",
  PLAN_TYPE_INVALID: "validation",
  PLAN_START_REQUIRED: "validation",
  PLAN_TIMING_INVALID: "validation",
  PLAN_ACTIVE_LIMIT_INVALID: "validation",
  PLAN_PARTICIPANT_LIMIT_INVALID: "validation",
  PLAN_INITIAL_PARTICIPANT_INVALID: "validation",
  PLAN_RSVP_INVALID: "validation",
  PLAN_PARTICIPANTS_REQUIRED: "validation",
  PLAN_NOT_FOUND: "not_found",
  HANGOUT_NOT_FOUND: "not_found",
  PLAN_NOT_AUTHORIZED: "not_authorized",
  HANGOUT_NOT_AUTHORIZED: "not_authorized",
  PLAN_PARTICIPANT_NOT_FOUND: "not_authorized",
  PLAN_PARTICIPANT_INELIGIBLE: "ineligible",
  PLAN_ACTIVE_LIMIT_REACHED: "limit_reached",
  PLAN_PARTICIPANT_LIMIT_REACHED: "limit_reached",
  PLAN_PARTICIPANT_REMOVED: "closed",
  PLAN_CLOSED: "closed",
  HANGOUT_NOT_CONVERTIBLE: "closed",
  PLAN_RSVP_DEADLINE_PASSED: "deadline_passed",
  PLAN_REQUEST_IN_PROGRESS: "conflict",
  HANGOUT_CONVERSION_CONFLICT: "conflict",
  PLAN_CONVERSATION_CONTEXT_CONFLICT: "conflict"
};

export function canonicalPlanErrorIdentifier(
  error: { message?: string; details?: string; hint?: string } | null
): string | null {
  const text = [error?.message, error?.details, error?.hint].filter(Boolean).join(" ");
  return Object.keys(RPC_ERROR_CODE).find((identifier) => text.includes(identifier)) ?? null;
}

export function mapCanonicalPlanError(
  error: { message?: string; details?: string; hint?: string } | null,
  fallback: string
): CanonicalPlanError {
  const identifier = canonicalPlanErrorIdentifier(error);
  const code = identifier ? RPC_ERROR_CODE[identifier] : "server_unavailable";
  const messages: Record<PlanServiceCode, string> = {
    validation: "Check the plan details and try again.",
    not_found: "Plan not found.",
    not_authorized: "You don't have permission to change this plan.",
    ineligible: "Only eligible approved Muddies can join this plan.",
    limit_reached: "This plan has reached its limit.",
    closed: "This plan is closed.",
    deadline_passed: "The RSVP deadline has passed.",
    conflict: "That change is already being processed. Try again.",
    rate_limited: "Please wait before trying again.",
    server_unavailable: fallback
  };
  return { ok: false, code, message: messages[code] };
}
