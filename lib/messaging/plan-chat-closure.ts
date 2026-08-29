/**
 * How a closed Plan Chat explains itself.
 *
 * Pure and separate from the component so the words can be tested and reused,
 * and so a caller cannot render this state from ingredients of its own: it
 * takes the SERVER'S resolved answer (`closed`) and only decides how to say it.
 */

/**
 * "30 Aug" -- the short, unambiguous form for a sentence.
 *
 * Deliberately not a relative phrase. "3 days ago" is the wrong thing to read
 * on a chat you have come back to weeks later, and it makes the notice change
 * meaning every day without anything actually changing.
 */
export function planEndedLabel(endedAtIso: string | null): string | null {
  if (!endedAtIso) return null;
  const ms = Date.parse(endedAtIso);
  if (!Number.isFinite(ms)) return null;
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" }).format(new Date(ms));
}

export type PlanChatClosedNotice = {
  title: string;
  /** Null when the plan's end date is unknown; the title still stands alone. */
  detail: string | null;
};

/**
 * The notice that replaces the composer.
 *
 * SAYS CLOSED, NEVER BROKEN. The chat is intact and every message in it is
 * still readable -- so the words state a fact about the plan rather than
 * apologising or implying something was removed. "This Plan Chat is closed"
 * is a state; "Something went wrong" or "No longer available" would both
 * suggest the history is gone, which is exactly what did NOT happen.
 */
export function planChatClosedNotice(endedAtIso: string | null): PlanChatClosedNotice {
  const ended = planEndedLabel(endedAtIso);
  return {
    title: "This Plan Chat is closed",
    detail: ended ? `The plan ended on ${ended}.` : null
  };
}
