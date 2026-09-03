/**
 * Outgoing messages appear the moment they are sent (spec R2 §8-§12).
 *
 * THE PRINCIPLE. Network confirmation changes the STATUS of a message; it does
 * not decide whether the message appears at all. Before this, the composer
 * waited for insert -> action response -> refetch before anything was drawn,
 * so on mediocre mobile data the chat looked broken for a second or more and
 * the person's own words were the last thing to arrive.
 *
 * WHY A PURE MODULE. Reconciliation is the part that goes subtly wrong -- one
 * message rendered twice, a pending row that never resolves, an order that
 * flips when the server acknowledges out of sequence. Kept out of the
 * component, those rules can be tested directly instead of through a DOM.
 *
 * The canonical list stays the authority. An optimistic row is a placeholder
 * shown UNTIL the server's own row for it arrives, never a competing record of
 * what was said.
 */

/** What an optimistic row adds to a canonical message. */
export type OptimisticStatus = "pending" | "sent" | "failed";

/**
 * A locally drawn message, keyed by the same idempotency key the send uses.
 *
 * Deliberately minimal: enough to draw a bubble and nothing that pretends to
 * be server truth. No message id, because it does not have one yet, and
 * inventing one would let it be mistaken for a canonical row.
 */
export type OptimisticMessage = {
  /** The idempotency key. The ONLY thing that ties this to the server's row. */
  clientMessageId: string;
  /** Text, or null for a voice note / attachment-only message. */
  text: string | null;
  /** Drives which bubble is drawn while pending. */
  kind: "text" | "voice";
  /** Local duration for a voice bubble, so it is not a bare grey box. */
  durationSeconds: number | null;
  /** Already-uploaded media reused by an idempotent retry; never re-uploaded. */
  mediaId?: string;
  /** When the person pressed Send. Orders the row against canonical rows. */
  createdAt: string;
  status: OptimisticStatus;
  /** Set only when the client stopped waiting without a definitive outcome. */
  confirmationState?: "unknown";
};

/** The shape this module needs from a canonical message. Widened by callers. */
type CanonicalLike = {
  clientMessageId: string | null;
  createdAt: string;
};

/**
 * Drops optimistic rows the server has now confirmed.
 *
 * THE DUPLICATE GUARD. Three things race to show one message: the optimistic
 * draw, the send's own response, and the Realtime echo. Matching on
 * clientMessageId -- the key the server stores and echoes back -- makes all
 * three converge on ONE row, because only the canonical row survives the
 * moment it exists.
 *
 * Failed rows are kept deliberately: a failed send has no canonical row to be
 * replaced by, and dropping it would silently delete the person's message.
 */
export function pruneConfirmed<T extends CanonicalLike>(
  optimistic: OptimisticMessage[],
  canonical: T[]
): OptimisticMessage[] {
  const confirmed = new Set(
    canonical.map((message) => message.clientMessageId).filter((key): key is string => Boolean(key))
  );
  return optimistic.filter((message) => !confirmed.has(message.clientMessageId));
}

/**
 * Places still-pending rows after the canonical ones, in send order.
 *
 * ORDERING (§24). Canonical messages keep the server's order, which is the
 * authority. Pending rows sort among THEMSELVES by the moment Send was
 * pressed, so sending A, B, C fast shows A, B, C -- and as each is confirmed
 * it leaves this list for its canonical position. Acknowledgement order never
 * reaches the screen.
 *
 * Pending rows always sit last because they are the newest thing in the
 * conversation: they were composed after everything already persisted.
 */
export function mergeForDisplay<T extends CanonicalLike>(
  canonical: T[],
  optimistic: OptimisticMessage[]
): Array<T | OptimisticMessage> {
  const pending = pruneConfirmed(optimistic, canonical);
  const ordered = [...pending].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return [...canonical, ...ordered];
}

/** True for placeholder rows, so a renderer can branch without casting. */
export function isOptimistic(message: { clientMessageId?: string | null; status?: unknown }): message is OptimisticMessage {
  return message.status === "pending" || message.status === "sent" || message.status === "failed";
}

/**
 * Marks one row failed, keeping it on screen (§17).
 *
 * A failed message is never removed. The person wrote it; losing it to a
 * network blip is the one outcome this whole design exists to prevent, and
 * "Not sent -- tap to retry" is only possible if the row is still there.
 */
export function markFailed(optimistic: OptimisticMessage[], clientMessageId: string): OptimisticMessage[] {
  return optimistic.map((message) =>
    message.clientMessageId === clientMessageId ? { ...message, status: "failed" as const } : message
  );
}

/** Keeps an ambiguous timeout pending while a bounded resolver checks truth. */
export function markAwaitingConfirmation(
  optimistic: OptimisticMessage[],
  clientMessageId: string
): OptimisticMessage[] {
  return optimistic.map((message) =>
    message.clientMessageId === clientMessageId
      ? { ...message, status: "pending" as const, confirmationState: "unknown" as const }
      : message
  );
}

/**
 * Advances an optimistic row according to where the acknowledgement came from.
 *
 * The same helper is used in two places:
 * - pending -> sent when the server has accepted the original send;
 * - failed -> pending when the person explicitly retries.
 *
 * That distinction lets the UI show the first delivery tick immediately on the
 * server acknowledgement without falsely showing a retry as sent before its
 * network request succeeds.
 */
export function markRetrying(optimistic: OptimisticMessage[], clientMessageId: string): OptimisticMessage[] {
  return optimistic.map((message) =>
    message.clientMessageId === clientMessageId
      ? {
          ...message,
          status: message.status === "failed" ? "pending" as const : "sent" as const,
          confirmationState: undefined
        }
      : message
  );
}

/** Removes a row the person explicitly discarded. The only way one disappears unsent. */
export function discardOptimistic(
  optimistic: OptimisticMessage[],
  clientMessageId: string
): OptimisticMessage[] {
  return optimistic.filter((message) => message.clientMessageId !== clientMessageId);
}
