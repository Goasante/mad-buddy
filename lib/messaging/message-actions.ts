import { canDeleteForEveryone, canEditMessage } from "@/lib/messaging/rules";

/**
 * Which contextual actions a message actually offers.
 *
 * Pure and server-mirroring. Every entry here corresponds to a capability the
 * backend already implements -- there is no Reply, Forward or Report, because
 * no server action exists for them and a menu item that does nothing is worse
 * than an absent one.
 *
 * The authorization rules are IMPORTED, not restated: `canEditMessage` and
 * `canDeleteForEveryone` are the same predicates messaging-actions.ts enforces,
 * so the menu cannot drift into offering something the server will refuse.
 * This is presentation-layer filtering for honesty, never a security boundary
 * -- the server re-checks everything regardless.
 */

export type MessageActionId = "copy" | "react" | "edit" | "delete_for_me" | "delete_for_everyone";

export type MessageActionSubject = {
  isMine: boolean;
  messageType: string;
  /** Already tombstoned: "This message was deleted." */
  isDeleted: boolean;
  createdAtMs: number;
  /** Present and non-empty for text messages. */
  text: string | null;
};

export function messageActions(
  subject: MessageActionSubject,
  nowMs: number
): MessageActionId[] {
  // A tombstone is a record that something was removed. Acting on it --
  // copying empty text, reacting, deleting it again -- is meaningless, and
  // "delete for me" on an already-deleted row would imply the placeholder
  // itself can be hidden, which the backend does not model.
  if (subject.isDeleted) return [];

  // System messages (joins, leaves, role changes) belong to the conversation,
  // not to a person. Nobody may edit or delete the record of what happened.
  if (subject.messageType === "system") return [];

  const actions: MessageActionId[] = [];

  // Copy needs text to copy. A voice note or image has none, so offering it
  // would put a dead item in the menu of exactly the messages A2 calls out.
  if (subject.messageType === "text" && subject.text && subject.text.trim().length > 0) {
    actions.push("copy");
  }

  actions.push("react");

  // Edit is text-only, sender-only, and time-limited -- the same three
  // conditions the server enforces before accepting an edit.
  if (
    subject.messageType === "text" &&
    canEditMessage({
      isSender: subject.isMine,
      createdAtMs: subject.createdAtMs,
      nowMs,
      messageType: subject.messageType,
      deleted: subject.isDeleted
    })
  ) {
    actions.push("edit");
  }

  // Delete for me hides one person's copy and is always available on a
  // message they can see, including someone else's.
  actions.push("delete_for_me");

  // Delete for everyone tombstones the row for all participants. Sender-only
  // and inside the window, so it is never offered on another person's message
  // and never after it would be refused.
  if (canDeleteForEveryone({ isSender: subject.isMine, createdAtMs: subject.createdAtMs, nowMs })) {
    actions.push("delete_for_everyone");
  }

  return actions;
}

/**
 * User-facing labels.
 *
 * "Delete for everyone" is named honestly and only appears when that is
 * genuinely what will happen; the always-available option says "Delete for
 * me" rather than a bare "Delete" that would overstate its reach.
 */
export const MESSAGE_ACTION_LABELS: Record<MessageActionId, string> = {
  copy: "Copy text",
  react: "React",
  edit: "Edit",
  delete_for_me: "Delete for me",
  delete_for_everyone: "Delete for everyone"
};

/** Destructive actions are styled apart and sit below a separator. */
export function isDestructiveMessageAction(action: MessageActionId): boolean {
  return action === "delete_for_me" || action === "delete_for_everyone";
}
