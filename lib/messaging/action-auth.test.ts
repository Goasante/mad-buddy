import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * EVERY MESSAGING ACTION STATES ITS OWN AUTH CHOICE.
 *
 * The failure this prevents is not a clever attack, it is drift. Messaging was
 * once classified by FILE: one private `getAuthedUserId` per file, so every
 * action inherited whatever answer happened to be there and the security
 * decision was invisible at the call site. Adding an action to the file was
 * enough to inherit it.
 *
 * So the rule is enforced against the shipped source: if an action's success
 * is observable by an account other than the caller's, it must resolve its
 * user through `getAuthoritativeMessagingUserId` -- the one that notices a
 * global sign-out. Reads and self-only writes may use the fast path.
 *
 * Structural on purpose. A behavioural test would need every action mocked
 * deeply enough to stop resembling the real one, which is exactly how the
 * per-file classification survived review in the first place.
 */

const FILES = [
  "app/(app)/messaging-actions.ts",
  "app/(app)/messaging-v3-actions.ts",
  "app/(app)/messaging-role-action.ts",
  "app/(app)/messaging-ultimate-actions.ts"
];

/* Observable by somebody other than the caller: sends, edits, deletions,
   reactions, polls, pins, broadcast presence, uploads, shared settings, and
   creating a conversation. */
const AUTHORITATIVE = new Set([
  "openDirectConversationAction",
  "sendMessageAction",
  "editMessageAction",
  "deleteMessageAction",
  "reactToMessageAction",
  "removeMessageReactionAction",
  "createMessageAttachmentUploadIntentAction",
  "createVoiceMessageUploadIntentAction",
  "finalizeVoiceMessageUploadAction",
  "finalizeMessageAttachmentUploadAction",
  "uploadMessageAttachmentAction",
  "discardMessageAttachmentAction",
  "heartbeatConversationPresenceAction",
  "setPinnedMessageAction",
  "updateConversationChatSettingsAction",
  "createChatPollAction",
  "voteChatPollAction",
  "closeChatPollAction",
  "keepMessageInChatAction"
]);

type Action = { name: string; body: string; file: string };

function actionsIn(file: string): Action[] {
  const source = readFileSync(file, "utf8").replace(/\r\n/g, "\n");
  const found: Action[] = [];
  const marker = /^export async function (\w+)/gm;
  let match: RegExpExecArray | null;
  while ((match = marker.exec(source))) {
    const next = source.indexOf("\nexport async function", match.index + 10);
    found.push({
      name: match[1],
      file,
      body: source.slice(match.index, next === -1 ? source.length : next)
    });
  }
  return found;
}

const ALL = FILES.flatMap(actionsIn);

describe("messaging actions are classified per action, not per file", () => {
  it("finds the exported actions", () => {
    // Guards against a broken matcher silently asserting nothing.
    expect(ALL.length).toBeGreaterThan(35);
  });

  it("no action resolves its user any way other than the two named helpers", () => {
    /* Calling getCurrentIdentity or supabase.auth.getUser directly would put
       the choice back out of sight. */
    for (const action of ALL) {
      expect(action.body, `${action.name} calls getUser directly`).not.toContain("auth.getUser(");
      expect(action.body, `${action.name} bypasses the named helpers`).not.toContain("getCurrentIdentity(");
    }
  });

  it("every externally observable action uses the authoritative helper", () => {
    for (const action of ALL) {
      if (!AUTHORITATIVE.has(action.name)) continue;
      expect(
        action.body,
        `${action.name} is observable by another account and must see revocation`
      ).toContain("getAuthoritativeMessagingUserId()");
      expect(
        action.body,
        `${action.name} must not resolve identity from claims alone`
      ).not.toContain("getMessagingIdentityId()");
    }
  });

  it("the fast path is used only by reads and self-only writes", () => {
    for (const action of ALL) {
      if (AUTHORITATIVE.has(action.name)) continue;
      if (!action.body.includes("getMessagingIdentityId()")) continue;
      expect(
        action.body,
        `${action.name} uses the fast path but is not in the reviewed self-only set`
      ).not.toContain("getAuthoritativeMessagingUserId()");
    }
  });

  it("every action that resolves a user does so through one of the two", () => {
    for (const action of ALL) {
      const resolves = /const userId = await |const identity = await /.test(action.body);
      if (!resolves) continue;
      const named =
        action.body.includes("getMessagingIdentityId()") ||
        action.body.includes("getAuthoritativeMessagingUserId()");
      expect(named, `${action.name} resolves a user by some other means`).toBe(true);
    }
  });
});

describe("service-role writes confirm current conversation membership", () => {
  /* Four actions performed service-role writes without ever asking whether the
     caller is still in the conversation. Being the sender of a message is not
     the same as still being a member of the chat it lives in: somebody removed
     from a group could edit and delete their old messages inside it. */
  const MUST_CHECK_ACCESS = [
    "muteConversationAction",
    "editMessageAction",
    "deleteMessageAction",
    "removeMessageReactionAction",
    "reactToMessageAction"
  ];

  it("each one calls resolveConversationAccess and refuses without canView", () => {
    for (const name of MUST_CHECK_ACCESS) {
      const action = ALL.find((entry) => entry.name === name);
      expect(action, `${name} not found`).toBeDefined();
      if (!action) continue;

      expect(action.body, `${name} does not check conversation access`).toContain(
        "resolveConversationAccess("
      );
      expect(action.body, `${name} does not refuse a non-member`).toMatch(/if \(!access\.canView\)/);
    }
  });

  it("edit and delete-for-everyone check access as well as the sender rules", () => {
    /* Both conditions, not either: the access check must not have replaced the
       sender/time rules that stop you editing another person's message. */
    const edit = ALL.find((entry) => entry.name === "editMessageAction")?.body ?? "";
    expect(edit).toContain("canEditMessage(");
    expect(edit).toContain("resolveConversationAccess(");

    const remove = ALL.find((entry) => entry.name === "deleteMessageAction")?.body ?? "";
    expect(remove).toContain("canDeleteForEveryone(");
    expect(remove).toContain("resolveConversationAccess(");
  });

  it("delete-for-me stays ungated, deliberately", () => {
    /* Hiding your own copy of a message from a conversation you have left is
       reasonable and changes nothing anyone else sees. Recorded so the
       asymmetry reads as a decision rather than an oversight. */
    const body = ALL.find((entry) => entry.name === "deleteMessageAction")?.body ?? "";
    const forMe = body.slice(body.indexOf("if (!forEveryone)"), body.indexOf("const { data: message }"));
    expect(forMe).toContain("message_hides");
    expect(forMe).not.toContain("resolveConversationAccess(");
  });
});
