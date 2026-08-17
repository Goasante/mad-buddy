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
  /* A Plan Chat says WHICH plan and WHEN, not merely that a plan exists.
   *
   * "From a shared plan" restated the badge sitting next to it and told the
   * reader nothing they could act on. The title already names the Plan, so the
   * line underneath is the useful half: the type, then the date.
   *
   * planPhase is the server's answer about time, so a finished or cancelled
   * Plan says so instead of advertising a date that has passed. */
  if (conversation.contextBadge === "Plan") {
    return { subtitle: planContextLine(conversation), shared: true };
  }
  if (conversation.contextBadge) {
    // "Event" / "Safe Arrival" — the reason the two of you are talking.
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

/**
 * "Plan · Tue, Aug 18 · 12:38 PM" — the Plan's own context line.
 *
 * Every branch is derived from what the server already sent. A Plan that has
 * finished, been cancelled or expired never advertises a date as though it were
 * still coming; an undated Plan says so plainly rather than inventing a time.
 */
function planContextLine(conversation: ConversationView): string {
  const phase = conversation.planPhase;
  /* planPhase folds cancelled, completed and expired into "past" -- status wins
   * over the clock there -- so one branch covers every Plan that is over. */
  if (phase === "past") return "Plan · Finished";
  if (phase === "unscheduled" || phase === "archived_unscheduled" || !conversation.planStartAt) {
    return "Plan · No date yet";
  }

  const startsAt = new Date(conversation.planStartAt);
  if (Number.isNaN(startsAt.getTime())) return "Plan";

  // The viewer's own locale and zone, matching how Plans renders the same date.
  const day = startsAt.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
  const time = startsAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return `Plan · ${day} · ${time}`;
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
  message: RunMessage,
  previous: RunMessage | undefined
): boolean {
  if (!previous) return true;
  if (previous.isMine !== message.isMine) return true;
  // SENDER CHANGE, for group conversations.
  //
  // `isMine` alone is enough in a direct conversation — there are only two
  // people, so "not mine" identifies the other one. In a group it does not:
  // Ama and Kofi are both "not mine", and without this every incoming message
  // in the thread would merge into a single run under whoever spoke first.
  //
  // Compared only when BOTH messages carry a senderId, so direct callers that
  // pass neither keep their exact previous behaviour.
  if (message.senderId !== undefined && previous.senderId !== undefined) {
    if (message.senderId !== previous.senderId) return true;
  }
  // A system/event message is nobody's, so it always breaks the run on both
  // sides rather than being absorbed into a neighbouring person's block.
  if (isSystemMessage(message) || isSystemMessage(previous)) return true;
  // A date boundary implies a new run even inside the gap window — a run may
  // never straddle the day divider drawn between its own messages.
  if (startsNewDay(message.createdAt, previous.createdAt)) return true;
  return Date.parse(message.createdAt) - Date.parse(previous.createdAt) > RUN_GAP_MS;
}

/**
 * What run-grouping needs to know about a message.
 *
 * `senderId` and `messageType` are optional so the direct-conversation callers
 * that predate group support keep working unchanged.
 */
export type RunMessage = {
  isMine: boolean;
  createdAt: string;
  /** Stable user id. Null for system messages; undefined when not supplied. */
  senderId?: string | null;
  messageType?: string;
};

/** System/event messages have no human author. */
function isSystemMessage(message: RunMessage): boolean {
  return message.senderId === null || message.messageType === "system";
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
