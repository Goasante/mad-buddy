import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * AN EXHAUSTIVE CLASSIFICATION CONTRACT.
 *
 * Every exported messaging action must be classified exactly once, and the
 * union of the classes must equal the actions actually discovered on disk. A
 * new action fails this file until somebody consciously classifies it.
 *
 * That property is the point, and it is what two earlier versions lacked:
 *
 *   v1 classified by FILE, so an action inherited whichever helper its
 *      neighbours happened to use;
 *   v2 held a one-sided AUTHORITATIVE allowlist, so anything omitted from it
 *      was silently accepted as self-only -- the DEFAULT WAS UNSAFE. Two
 *      misclassified actions survived it: communication preferences, which
 *      controls who may message the account, and leaving presence, which
 *      other members can see.
 *
 * So there is no fallback here. "Not in AUTHORITATIVE" is not a claim about
 * safety; only membership of PURE_READ or SELF_ONLY is, and both are asserted
 * against the shipped source.
 *
 * THE RULE: if the effect is observable by, or authorizes, an account other
 * than the caller, the action resolves its user authoritatively -- the only
 * helper that notices a global sign-out. Otherwise the fast local JWT path is
 * allowed.
 *
 * Actions are keyed `file::name`, because keepMessageInChatAction exists in
 * two files with different implementations.
 */

const DIR = "app/(app)";

/** Discovered from disk, never hand-maintained. */
function messagingFiles(): string[] {
  return readdirSync(DIR)
    .filter((name) => /^messaging-.*\.ts$/.test(name) && !name.includes(".test."))
    .sort();
}

type Action = { key: string; name: string; file: string; body: string };

function actionsIn(file: string): Action[] {
  const source = readFileSync(`${DIR}/${file}`, "utf8").replace(/\r\n/g, "\n");
  const base = file.replace(/\.ts$/, "");
  const found: Action[] = [];
  const marker = /^export async function (\w+)/gm;
  let match: RegExpExecArray | null;
  while ((match = marker.exec(source))) {
    const next = source.indexOf("\nexport async function", match.index + 10);
    found.push({
      key: `${base}::${match[1]}`,
      name: match[1],
      file,
      body: source.slice(match.index, next === -1 ? source.length : next)
    });
  }
  return found;
}

const ALL = messagingFiles().flatMap(actionsIn);
const KEYS = new Set(ALL.map((action) => action.key));
const bodyFor = (key: string) => ALL.find((action) => action.key === key)?.body ?? "";

/* Reads. Gated by resolveConversationAccess where they touch a conversation,
   and they write nothing.

   These are low-risk messaging-context reads, which is broader than "your own
   threads": messageable-friend discovery and structured-share options are
   here too. Stated plainly rather than described as narrower than it is. */
const PURE_READ = new Set([
  "messaging-actions::getCommunicationPreferencesAction",
  "messaging-actions::getConversationsAction",
  "messaging-actions::getMentionCandidatesAction",
  "messaging-actions::getMessageAction",
  "messaging-actions::getMessageByClientMessageIdAction",
  "messaging-actions::getMessageVoicePlaybackAction",
  "messaging-actions::getMessageableFriendsAction",
  "messaging-actions::getMessagesAction",
  "messaging-actions::getPreparedVoicePlaybackAction",
  "messaging-actions::getRecentMessagesAction",
  "messaging-actions::getVoiceRecorderConfigAction",
  "messaging-actions::refreshMessageAttachmentAction",
  "messaging-inbox-v4-actions::getInboxConversationPreferencesAction",
  "messaging-reaction-summary-action::getConversationReactionSummariesAction",
  "messaging-retention-v4-actions::getMessageRetentionAction",
  "messaging-rich-media-actions::getRichMediaMessageAction",
  "messaging-role-action::getConversationViewerRoleAction",
  "messaging-structured-share-actions::getStructuredMessagePayloadAction",
  "messaging-structured-share-actions::getStructuredShareOptionsAction",
  "messaging-ultimate-actions::getUltimateConversationStateAction",
  "messaging-v3-actions::getReplyContextsAction",
  "messaging-v4-insights-actions::getChatCollectionsAction",
  "messaging-v4-insights-actions::getMessageInfoAction"
]);

/* Writes to the caller's OWN row whose value nobody else reads and which
   authorizes nothing.

   BOTH halves of that sentence matter. Self-owned storage alone is not
   sufficient: updateCommunicationPreferencesAction writes only the caller's
   own row and still belongs in AUTHORITATIVE, because another account's
   access is decided from what it contains. */
const SELF_ONLY = new Set([
  "messaging-actions::muteConversationAction",
  "messaging-actions::setConversationHiddenAction",
  "messaging-actions::setConversationPinnedAction",
  "messaging-ultimate-actions::setSavedMessageAction",
  "messaging-ultimate-actions::updateConversationUserPreferencesAction"
]);

/* Observable by, or authorizing, another account. */
const AUTHORITATIVE = new Set([
  "messaging-actions::openDirectConversationAction",
  "messaging-actions::sendMessageAction",
  "messaging-actions::markConversationReadAction",
  "messaging-actions::editMessageAction",
  "messaging-actions::deleteMessageAction",
  "messaging-actions::reactToMessageAction",
  "messaging-actions::removeMessageReactionAction",
  "messaging-actions::updateCommunicationPreferencesAction",
  "messaging-actions::createMessageAttachmentUploadIntentAction",
  "messaging-actions::createVoiceMessageUploadIntentAction",
  "messaging-actions::finalizeVoiceMessageUploadAction",
  "messaging-actions::finalizeMessageAttachmentUploadAction",
  "messaging-actions::uploadMessageAttachmentAction",
  "messaging-actions::discardMessageAttachmentAction",
  "messaging-delivery-actions::markInboxDeliveredAction",
  "messaging-forward-actions::forwardMessageAction",
  "messaging-retention-v4-actions::keepMessageInChatAction",
  "messaging-rich-media-actions::createChatRichMediaUploadIntentAction",
  "messaging-rich-media-actions::finalizeChatRichMediaUploadAction",
  "messaging-structured-share-actions::sendStructuredChatMessageAction",
  "messaging-ultimate-actions::heartbeatConversationPresenceAction",
  "messaging-ultimate-actions::leaveConversationPresenceAction",
  "messaging-ultimate-actions::setPinnedMessageAction",
  "messaging-ultimate-actions::updateConversationChatSettingsAction",
  "messaging-ultimate-actions::createChatPollAction",
  "messaging-ultimate-actions::voteChatPollAction",
  "messaging-ultimate-actions::closeChatPollAction",
  "messaging-ultimate-actions::keepMessageInChatAction",
  "messaging-v4-insights-actions::createSavedMessageFolderAction",
  "messaging-v4-insights-actions::renameSavedMessageFolderAction",
  "messaging-v4-insights-actions::deleteSavedMessageFolderAction",
  "messaging-v4-insights-actions::moveSavedMessageToFolderAction"
]);

/* Deliberately empty. An exception would be a claims-only identity permitted
   to do something externally visible, and each would need its own invariant
   test below. Leaving presence was the candidate -- clearing it is
   privacy-reducing -- and it was made authoritative instead, because one rule
   with no exceptions is worth more than one round trip on a rare action. */
const SAFE_EXCEPTIONS = new Set<string>([]);

const CLASSES: Array<[string, Set<string>]> = [
  ["PURE_READ", PURE_READ],
  ["SELF_ONLY", SELF_ONLY],
  ["AUTHORITATIVE", AUTHORITATIVE],
  ["SAFE_EXCEPTIONS", SAFE_EXCEPTIONS]
];

describe("the classification is exhaustive", () => {
  it("discovers actions from disk", () => {
    // A broken matcher must fail loudly rather than assert nothing.
    expect(messagingFiles().length).toBeGreaterThanOrEqual(12);
    expect(ALL.length).toBeGreaterThanOrEqual(60);
  });

  it("classifies every discovered action -- a new one fails until classified", () => {
    const classified = new Set(CLASSES.flatMap(([, set]) => [...set]));
    const unclassified = [...KEYS].filter((key) => !classified.has(key)).sort();
    expect(unclassified, `unclassified actions: ${unclassified.join(", ")}`).toEqual([]);
  });

  it("classifies nothing that does not exist", () => {
    /* Catches a rename that drops an action out of every class while leaving
       a stale entry behind to keep the totals looking right. */
    for (const [label, set] of CLASSES) {
      const ghosts = [...set].filter((key) => !KEYS.has(key)).sort();
      expect(ghosts, `${label} names actions that do not exist: ${ghosts.join(", ")}`).toEqual([]);
    }
  });

  it("classifies each action exactly once", () => {
    const seen = new Map<string, string[]>();
    for (const [label, set] of CLASSES) {
      for (const key of set) seen.set(key, [...(seen.get(key) ?? []), label]);
    }
    const duplicates = [...seen.entries()]
      .filter(([, labels]) => labels.length > 1)
      .map(([key, labels]) => `${key}: ${labels.join("+")}`);
    expect(duplicates).toEqual([]);
  });

  it("the classes exactly cover the discovered actions", () => {
    const union = new Set(CLASSES.flatMap(([, set]) => [...set]));
    expect(union).toEqual(KEYS);
  });
});

describe("each class uses the helper its classification requires", () => {
  it("PURE_READ resolves identity locally and never authoritatively", () => {
    for (const key of PURE_READ) {
      expect(bodyFor(key), `${key} should use the fast path`).toContain("getMessagingIdentityId()");
      expect(bodyFor(key), `${key} pays for freshness it does not need`).not.toContain(
        "getAuthoritativeMessagingUserId()"
      );
    }
  });

  it("SELF_ONLY resolves identity locally and never authoritatively", () => {
    for (const key of SELF_ONLY) {
      expect(bodyFor(key), `${key} should use the fast path`).toContain("getMessagingIdentityId()");
      expect(bodyFor(key), `${key} pays for freshness it does not need`).not.toContain(
        "getAuthoritativeMessagingUserId()"
      );
    }
  });

  it("AUTHORITATIVE resolves the real user record and never claims alone", () => {
    for (const key of AUTHORITATIVE) {
      expect(bodyFor(key), `${key} must see revocation`).toContain(
        "getAuthoritativeMessagingUserId()"
      );
      expect(bodyFor(key), `${key} must not resolve identity from claims alone`).not.toContain(
        "getMessagingIdentityId()"
      );
    }
  });

  it("no action resolves a user any other way", () => {
    for (const action of ALL) {
      expect(action.body, `${action.key} calls getUser directly`).not.toContain("auth.getUser(");
      expect(action.body, `${action.key} bypasses the named helpers`).not.toContain(
        "getCurrentIdentity("
      );
    }
  });

  it("every action that resolves a user does so through one of the two", () => {
    for (const action of ALL) {
      if (!/const userId = await |const identity = await /.test(action.body)) continue;
      const named =
        action.body.includes("getMessagingIdentityId()") ||
        action.body.includes("getAuthoritativeMessagingUserId()");
      expect(named, `${action.key} resolves a user by some other means`).toBe(true);
    }
  });
});

describe("the two defects this contract was written to catch", () => {
  it("communication preferences are authoritative -- messagePermission authorizes others", () => {
    /* The write touches only the caller's own row, which is exactly why a
       one-sided allowlist accepted it. But canCreateDirectConversation reads
       the RECIPIENT's messagePermission to decide whether somebody may open a
       conversation with them, so this value authorizes other people's access
       and a revoked session must not be able to widen it. */
    expect(bodyFor("messaging-actions::updateCommunicationPreferencesAction")).toContain(
      "getAuthoritativeMessagingUserId()"
    );

    const service = readFileSync("lib/messaging/service.ts", "utf8");
    const gate = service.slice(
      service.indexOf("export async function canCreateDirectConversation")
    );
    expect(
      gate.slice(0, 2500),
      "messagePermission must still be an authorization input, or this rationale is stale"
    ).toContain("messagePermission");
  });

  it("leaving presence is authoritative -- other members read that row", () => {
    /* The conversation state loader selects conversation_presence for the
       whole conversation, not just the caller, so deleting the row changes
       what other people see. */
    expect(bodyFor("messaging-ultimate-actions::leaveConversationPresenceAction")).toContain(
      "getAuthoritativeMessagingUserId()"
    );
  });

  it("both presence writes agree, so clearing is never weaker than setting", () => {
    for (const key of [
      "messaging-ultimate-actions::heartbeatConversationPresenceAction",
      "messaging-ultimate-actions::leaveConversationPresenceAction"
    ]) {
      expect(bodyFor(key), `${key} must be authoritative`).toContain(
        "getAuthoritativeMessagingUserId()"
      );
    }
  });

  it("every safe exception carries an explicit invariant test", () => {
    /* Empty today. If one is ever added this fails until its invariant is
       written down and asserted, rather than resting on a comment. */
    expect([...SAFE_EXCEPTIONS]).toEqual([]);
  });
});

describe("service-role writes confirm current conversation membership", () => {
  /* Being the sender of a message is not the same as still being a member of
     the chat it lives in: somebody removed from a group could edit and delete
     their old messages inside it. */
  const MUST_CHECK_ACCESS = [
    "messaging-actions::muteConversationAction",
    "messaging-actions::editMessageAction",
    "messaging-actions::deleteMessageAction",
    "messaging-actions::removeMessageReactionAction",
    "messaging-actions::reactToMessageAction"
  ];

  it("each one calls resolveConversationAccess and refuses without canView", () => {
    for (const key of MUST_CHECK_ACCESS) {
      expect(bodyFor(key), `${key} does not check conversation access`).toContain(
        "resolveConversationAccess("
      );
      expect(bodyFor(key), `${key} does not refuse a non-member`).toMatch(/if \(!access\.canView\)/);
    }
  });

  it("edit and delete-for-everyone check access as well as the sender rules", () => {
    const edit = bodyFor("messaging-actions::editMessageAction");
    expect(edit).toContain("canEditMessage(");
    expect(edit).toContain("resolveConversationAccess(");

    const remove = bodyFor("messaging-actions::deleteMessageAction");
    expect(remove).toContain("canDeleteForEveryone(");
    expect(remove).toContain("resolveConversationAccess(");
  });

  it("delete-for-me stays ungated, deliberately", () => {
    /* Hiding your own copy of a message from a conversation you have left is
       reasonable and changes nothing anyone else sees. Recorded so the
       asymmetry reads as a decision rather than an oversight. */
    const body = bodyFor("messaging-actions::deleteMessageAction");
    const forMe = body.slice(
      body.indexOf("if (!forEveryone)"),
      body.indexOf("const { data: message }")
    );
    expect(forMe).toContain("message_hides");
    expect(forMe).not.toContain("resolveConversationAccess(");
  });
});
