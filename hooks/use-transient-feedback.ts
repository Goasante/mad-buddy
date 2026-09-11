"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Feedback that confirms an action, then gets out of the way.
 *
 * WHAT WENT WRONG WITHOUT IT. Sending a message set a page-level `feedback`
 * string to the server's success text ("Sent") and nothing ever cleared it. It
 * rendered as a full bordered banner above the inbox, survived navigating back
 * to Messages, and could still be there after a reload -- a confirmation that
 * had quietly become permanent furniture.
 *
 * A CONFIRMATION IS NOT A STATUS. "Sent" describes a moment; "Going" describes
 * the world and must stay until the world changes. This only ever auto-clears
 * the first kind, so RSVP state, pin state and mute state are untouched by it.
 *
 * Delivery failure is different again: V4 owns it on the failed message row,
 * where the person can Retry or Delete. A second floating "took too long"
 * banner describes transport internals, obscures the chat, and competes with
 * the actionable state directly beneath the message.
 */

/** Matches the interval the two hand-rolled implementations already used. */
export const TRANSIENT_FEEDBACK_MS = 4000;

/**
 * Delivery/refresh failures that have a better local home than the page banner.
 * Keep this deliberately exact: account, moderation, permission and destructive
 * action errors still need the global surface and must never be hidden merely
 * because they contain generic words like "failed" or "try again".
 */
export function suppressGlobalMessagingFeedback(message: string): boolean {
  const text = message.trim().toLowerCase();
  return text === "chats took too long to respond. try again."
    || text === "messages took too long to respond. try again."
    || text === "could not retry."
    || text === "the message could not be sent. try again."
    || text === "couldn't send that voice message. try again.";
}

/**
 * Does this message report a transient confirmation?
 *
 * Server actions here return a human sentence rather than a severity, so tone
 * is what there is to go on. Deliberately generous: an unrecognised message is
 * treated as an ERROR and left on screen, because wrongly keeping a
 * confirmation is a blemish while wrongly hiding a failure loses information
 * the person needed.
 */
export function isTransientConfirmation(message: string): boolean {
  if (!message) return false;
  const text = message.toLowerCase().trim();

  // Anything reading as a failure stays, checked first so a sentence like
  // "Saved, but the photo could not be uploaded" is kept rather than expired
  // on the strength of its first word.
  const failureSignals = [
    "could not",
    "couldn't",
    "cannot",
    "can't",
    "failed",
    "try again",
    "too long",
    "not allowed",
    "no longer",
    "unavailable",
    "went wrong",
    "error",
    "denied",
    "invalid",
    "required",
    "must ",
    "already",
    "unable",
    "exceeded",
    "limit",
    "not "
  ];
  if (failureSignals.some((signal) => text.includes(signal))) return false;

  /**
   * ALLOW-LIST, not a catch-all.
   *
   * An earlier version expired anything that did not look like a failure,
   * which is the wrong default: a message nobody anticipated ("Quota exceeded
   * for this operation") would be silently hidden after four seconds. Only
   * wording recognised as a completed action expires; everything else stays on
   * screen, so an unforeseen message errs towards being read.
   */
  const confirmationSignals = [
    "sent",
    "saved",
    "updated",
    "copied",
    "removed",
    "deleted",
    "published",
    "created",
    "joined",
    "left",
    "pinned",
    "unpinned",
    "muted",
    "unmuted",
    "added",
    "invited",
    "accepted",
    "declined",
    "blocked",
    "unblocked",
    "cancelled",
    "canceled",
    "done",
    "shared",
    "uploaded"
  ];
  return confirmationSignals.some((signal) => text.includes(signal));
}

/**
 * A feedback string that clears itself when it is a confirmation.
 *
 * Returns the same [value, setValue] shape as useState, so a component adopting
 * it changes one line and every existing `setFeedback(...)` call site keeps
 * working unchanged.
 */
export function useTransientFeedback(
  timeoutMs: number = TRANSIENT_FEEDBACK_MS
): [string, (message: string) => void] {
  const [feedback, setRawFeedback] = useState("");
  // Held in a ref so a replacement message restarts the clock rather than
  // inheriting the remaining time from the message it replaced.
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * Referentially stable, exactly like the useState setter it replaces.
   *
   * Call sites pass this into useCallback/useEffect dependency arrays and into
   * child props; if its identity changed per render it would silently
   * invalidate those memos and re-run effects on every keystroke.
   */
  const setFeedback = useCallback((message: string) => {
    if (suppressGlobalMessagingFeedback(message)) {
      setRawFeedback("");
      return;
    }
    setRawFeedback(message);
  }, []);

  useEffect(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (!feedback || !isTransientConfirmation(feedback)) return;

    timerRef.current = setTimeout(() => {
      // The raw setter, not the memoized wrapper: this effect must depend only
      // on the message and the interval.
      setRawFeedback("");
      timerRef.current = null;
    }, timeoutMs);

    // Clears on unmount too, so navigating away mid-countdown cannot fire a
    // state update against a component that no longer exists.
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [feedback, timeoutMs]);

  return [feedback, setFeedback];
}
