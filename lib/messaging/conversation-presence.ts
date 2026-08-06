import type { ConversationView } from "@/lib/messaging/mobile";

/**
 * Presentation helpers for the conversation screen's context line.
 *
 * Pure: no React, no queries. Everything here is derived from the
 * ConversationView the page already loaded, so the header can never state a
 * relationship, a place or an availability the server did not already send.
 *
 * IMPORTANT: nothing in this module invents context. If a signal is absent the
 * line simply gets shorter — a conversation header is exactly the wrong place
 * to guess someone's location or whether they are free.
 */

/** Reasons a conversation exists, surfaced as a calm subtitle rather than a chip. */
export type ConversationContext = {
  /** Short subtitle under the name. Null when there is nothing true to say. */
  subtitle: string | null;
  /** Whether the context came from a shared Plan/Event, which we colour warmly. */
  shared: boolean;
};

/**
 * The one-line context under the name.
 *
 * Order of preference: the shared thing that created this conversation (a Plan,
 * an Event, a Safe Arrival), then the handle. A group falls back to naming what
 * kind of room it is.
 */
export function conversationContext(conversation: ConversationView): ConversationContext {
  if (conversation.contextBadge) {
    // "Plan" / "Event" / "Safe Arrival" — the reason the two of you are talking.
    return { subtitle: contextSubtitle(conversation.contextBadge), shared: true };
  }
  if (conversation.otherUsername) {
    return { subtitle: `@${conversation.otherUsername}`, shared: false };
  }
  if (conversation.kind && conversation.kind !== "direct") {
    return { subtitle: "Group conversation", shared: false };
  }
  return { subtitle: null, shared: false };
}

function contextSubtitle(badge: string): string {
  switch (badge) {
    case "Plan":
      return "From a shared plan";
    case "Event":
      return "From an event";
    case "Safe Arrival":
      return "Safe Arrival check-in";
    default:
      return badge;
  }
}

/**
 * Groups messages into runs by author and closeness in time.
 *
 * A run is what lets the thread breathe: consecutive messages from one person
 * within a few minutes share one avatar and one timestamp instead of repeating
 * both on every line. Purely visual — no message is merged, hidden or reordered.
 */
export const RUN_GAP_MS = 4 * 60 * 1000;

export function startsNewRun(
  message: { isMine: boolean; createdAt: string },
  previous: { isMine: boolean; createdAt: string } | undefined
): boolean {
  if (!previous) return true;
  if (previous.isMine !== message.isMine) return true;
  return Date.parse(message.createdAt) - Date.parse(previous.createdAt) > RUN_GAP_MS;
}

/**
 * Whether a day divider belongs above this message.
 *
 * Compared in the viewer's own locale day, so "Today" means their today rather
 * than UTC's.
 */
export function startsNewDay(createdAt: string, previousCreatedAt: string | undefined): boolean {
  if (!previousCreatedAt) return true;
  return new Date(createdAt).toDateString() !== new Date(previousCreatedAt).toDateString();
}

/** "Today" / "Yesterday" / a short date, for the divider. */
export function dayLabel(createdAt: string, nowMs = Date.now()): string {
  const date = new Date(createdAt);
  const today = new Date(nowMs);
  const yesterday = new Date(nowMs - 24 * 60 * 60 * 1000);

  if (date.toDateString() === today.toDateString()) return "Today";
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";

  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    // Only show the year when it is not the current one, so the divider stays short.
    year: date.getFullYear() === today.getFullYear() ? undefined : "numeric"
  });
}
