import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
import {
  isDestructiveMessageAction,
  MESSAGE_ACTION_LABELS,
  messageActions,
  type MessageActionSubject
} from "@/lib/messaging/message-actions";
import { DELETE_FOR_EVERYONE_WINDOW_MS, EDIT_WINDOW_MS } from "@/lib/messaging/rules";

/**
 * Which actions a message offers.
 *
 * Behavioural: every case runs the real predicate against a real subject, so
 * these prove authorization rather than asserting on source text.
 */

const NOW = 1_700_000_000_000;

function message(overrides: Partial<MessageActionSubject> = {}): MessageActionSubject {
  return {
    isMine: true,
    messageType: "text",
    isDeleted: false,
    createdAtMs: NOW - 1_000,
    text: "hello",
    ...overrides
  };
}

describe("my own recent text message", () => {
  it("offers the full set", () => {
    expect(messageActions(message(), NOW)).toEqual([
      "copy",
      "react",
      "edit",
      "delete_for_me",
      "delete_for_everyone"
    ]);
  });
});

describe("someone else's message", () => {
  /**
   * The rule that matters most: owner-only actions must never appear on
   * another person's message. The server would refuse them, so offering them
   * would be a menu that lies.
   */
  it("never offers edit or delete-for-everyone", () => {
    const actions = messageActions(message({ isMine: false }), NOW);
    expect(actions).not.toContain("edit");
    expect(actions).not.toContain("delete_for_everyone");
  });

  it("still offers copy, react and delete-for-me", () => {
    // Hiding your own copy of someone else's message is always allowed.
    expect(messageActions(message({ isMine: false }), NOW)).toEqual([
      "copy",
      "react",
      "delete_for_me"
    ]);
  });
});

describe("time windows", () => {
  it("drops edit once the edit window has passed", () => {
    const stale = message({ createdAtMs: NOW - EDIT_WINDOW_MS - 1 });
    expect(messageActions(stale, NOW)).not.toContain("edit");
  });

  it("keeps edit at the very edge of the window", () => {
    const edge = message({ createdAtMs: NOW - EDIT_WINDOW_MS });
    expect(messageActions(edge, NOW)).toContain("edit");
  });

  it("drops delete-for-everyone once its window has passed", () => {
    // Longer than the edit window, so this message can no longer be edited
    // either -- only the two always-available actions survive.
    const stale = message({ createdAtMs: NOW - DELETE_FOR_EVERYONE_WINDOW_MS - 1 });
    const actions = messageActions(stale, NOW);
    expect(actions).not.toContain("delete_for_everyone");
    expect(actions).toContain("delete_for_me");
  });

  it("keeps delete-for-everyone at the edge of its window", () => {
    const edge = message({ createdAtMs: NOW - DELETE_FOR_EVERYONE_WINDOW_MS });
    expect(messageActions(edge, NOW)).toContain("delete_for_everyone");
  });
});

describe("messages with no text to copy", () => {
  it("offers no copy for a voice note", () => {
    const voice = message({ messageType: "voice_note", text: null });
    expect(messageActions(voice, NOW)).not.toContain("copy");
  });

  it("offers no copy for an image", () => {
    expect(messageActions(message({ messageType: "image", text: null }), NOW)).not.toContain("copy");
  });

  it("offers no edit for media, which the server cannot edit", () => {
    const voice = message({ messageType: "voice_note", text: null });
    expect(messageActions(voice, NOW)).not.toContain("edit");
  });

  it("still lets media be deleted by its sender", () => {
    // Media deletion goes through the same tombstone path; retention and
    // cleanup are the server's business, not the menu's.
    const voice = message({ messageType: "voice_note", text: null });
    expect(messageActions(voice, NOW)).toContain("delete_for_everyone");
  });

  it("offers no copy for text that is only whitespace", () => {
    expect(messageActions(message({ text: "   " }), NOW)).not.toContain("copy");
  });
});

describe("messages that are not actionable at all", () => {
  it("offers nothing on an already-deleted message", () => {
    // The tombstone is a record that something was removed; acting on it is
    // meaningless.
    expect(messageActions(message({ isDeleted: true }), NOW)).toEqual([]);
  });

  it("offers nothing on a system message", () => {
    // Joins, leaves and role changes belong to the conversation itself.
    expect(messageActions(message({ messageType: "system", isMine: false }), NOW)).toEqual([]);
    expect(messageActions(message({ messageType: "system", isMine: true }), NOW)).toEqual([]);
  });
});

describe("presentation", () => {
  it("names delete actions by their real reach", () => {
    // "Delete" alone would overstate what delete-for-me does.
    expect(MESSAGE_ACTION_LABELS.delete_for_me).toBe("Delete for me");
    expect(MESSAGE_ACTION_LABELS.delete_for_everyone).toBe("Delete for everyone");
  });

  it("marks both deletes destructive and nothing else", () => {
    expect(isDestructiveMessageAction("delete_for_me")).toBe(true);
    expect(isDestructiveMessageAction("delete_for_everyone")).toBe(true);
    for (const safe of ["copy", "react", "edit"] as const) {
      expect(isDestructiveMessageAction(safe)).toBe(false);
    }
  });

  it("has a label for every action it can produce", () => {
    // No action can reach the menu without something to call it.
    const everyAction = new Set([
      ...messageActions(message(), NOW),
      ...messageActions(message({ isMine: false }), NOW)
    ]);
    for (const action of everyAction) {
      expect(MESSAGE_ACTION_LABELS[action], action).toBeTruthy();
    }
  });

  it("orders destructive actions last", () => {
    // The menu separator depends on this: safe actions, then deletes.
    const actions = messageActions(message(), NOW);
    const firstDestructive = actions.findIndex(isDestructiveMessageAction);
    expect(actions.slice(firstDestructive).every(isDestructiveMessageAction)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Wiring: one interaction system, not a second one for chat
// ---------------------------------------------------------------------------

describe("the message menu reuses the app's interaction architecture", () => {
  const menu = read("components/messaging/message-actions-menu.tsx");
  const page = read("components/messages/messages-page.tsx");

  it("uses the canonical long-press hook, not its own timer", () => {
    expect(menu).toContain('from "@/hooks/use-long-press"');
    // A second implementation is exactly what A1 forbids.
    expect(menu).not.toContain("setTimeout");
    expect(menu).not.toContain("LONG_PRESS_DURATION_MS =");
  });

  it("uses the canonical menu and haptics", () => {
    expect(menu).toContain('from "@/components/ui/app-dropdown"');
    expect(menu).toContain('from "@/lib/device/haptics"');
    expect(menu).not.toContain("navigator.vibrate");
  });

  it("wires every gesture the hook provides, including cancellation", () => {
    // Missing any one of these is how a hold survives a scroll or a
    // cancelled pointer.
    for (const handler of [
      "onPointerDown",
      "onPointerMove",
      "onPointerUp",
      "onPointerLeave",
      "onPointerCancel",
      "onContextMenu",
      "onClick"
    ]) {
      expect(menu, handler).toContain(`${handler}={handlers.${handler}}`);
    }
  });

  it("suppresses the click synthesised after a hold", () => {
    // Without this the bubble's own tap action fires under the open menu.
    expect(menu).toContain("onClick={handlers.onClick}");
  });

  it("renders no gesture when a message has no actions", () => {
    // A hold that opens an empty menu is worse than one that does nothing.
    expect(menu).toContain("if (!hasActions) return <>{children}</>;");
  });

  it("decides eligibility with the shared rule, not its own logic", () => {
    expect(menu).toContain("messageActions(subject, nowMs)");
    expect(menu).not.toContain("isMine &&");
  });
});

describe("message actions reach the canonical paths", () => {
  const page = read("components/messages/messages-page.tsx");

  it("routes both deletes to the one server action, with the right reach", () => {
    expect(page).toContain("remove(message.id, false)");
    expect(page).toContain("remove(message.id, true)");
    expect(page).toContain("deleteMessageAction(messageId, forEveryone)");
  });

  it("never optimistically removes a message the server may refuse", () => {
    // The thread is re-read after the mutation instead.
    const remove = page.slice(page.indexOf("function remove(messageId"), page.indexOf("// Defensive de-dup"));
    // The thread is re-read from the server, which is the only thing that
    // knows whether the delete was actually allowed.
    expect(remove).toContain("refreshMessages(selectedId)");
    // Any local mutation of the message list here would show the message
    // gone before -- or despite -- the server agreeing.
    expect(remove).not.toContain("setMessages");
  });

  it("reuses the existing react and edit controls", () => {
    // No parallel edit surface invented for the menu.
    const run = page.slice(page.indexOf("function runMessageAction"), page.indexOf("function sendQuickAction"));
    expect(run).toContain("setReactingId(message.id)");
    expect(run).toContain("setEditingId(message.id)");
  });
});
