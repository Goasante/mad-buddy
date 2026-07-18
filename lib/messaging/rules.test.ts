import { describe, expect, it } from "vitest";
import {
  buildNotificationPreview,
  canAssignAdmins,
  canDeleteForEveryone,
  canEditMessage,
  canManageGroup,
  canModerateMessages,
  directConversationKey,
  messagingLimitsFor,
  resolveCanSendMessage,
  resolveDirectMessageEligibility,
  resolveGroupAdd,
  resolvePresence,
  senderVisibleState,
  shouldShowTypingIndicator,
  systemMessageText,
  validateMessageText,
  validateVoiceNoteDuration,
  type DirectMessageEligibilityInput,
  type SendMessageInput
} from "@/lib/messaging/rules";

const NOW = Date.parse("2026-07-17T12:00:00.000Z");
const MIN = 60 * 1000;

describe("message validation (spec §8)", () => {
  it("rejects empty/whitespace and over-long messages", () => {
    expect(validateMessageText("")).toMatch(/Write a message/);
    expect(validateMessageText("   ")).toMatch(/Write a message/);
    expect(validateMessageText("x".repeat(2001))).toMatch(/at most/);
    expect(validateMessageText("hey 👋")).toBeNull();
  });
});

describe("directConversationKey (spec §4)", () => {
  it("is order-independent, so a pair can only ever have one conversation", () => {
    expect(directConversationKey("a", "b")).toBe(directConversationKey("b", "a"));
    expect(directConversationKey("a", "b")).not.toBe(directConversationKey("a", "c"));
  });
});

describe("direct message eligibility (spec §3, §54)", () => {
  function eligibility(overrides: Partial<DirectMessageEligibilityInput> = {}): DirectMessageEligibilityInput {
    return {
      areApprovedMuddies: true,
      isBlockedEitherDirection: false,
      recipientPermission: "all_muddies",
      senderIsCloseFriendOfRecipient: false,
      senderSharesSelectedCircle: false,
      recipientSuspended: false,
      senderSuspended: false,
      ...overrides
    };
  }

  it("allows approved Muddies by default", () => {
    expect(resolveDirectMessageEligibility(eligibility())).toEqual({ allowed: true, reason: "allowed" });
  });

  it("never lets a stranger message, whatever the recipient's preference", () => {
    expect(
      resolveDirectMessageEligibility(eligibility({ areApprovedMuddies: false, recipientPermission: "all_muddies" }))
        .reason
    ).toBe("not_muddies");
  });

  it("blocks override everything", () => {
    expect(
      resolveDirectMessageEligibility(
        eligibility({ isBlockedEitherDirection: true, senderIsCloseFriendOfRecipient: true })
      ).reason
    ).toBe("blocked");
  });

  it("honours close-friends-only and nobody", () => {
    expect(resolveDirectMessageEligibility(eligibility({ recipientPermission: "nobody" })).allowed).toBe(false);
    expect(
      resolveDirectMessageEligibility(
        eligibility({ recipientPermission: "close_friends", senderIsCloseFriendOfRecipient: false })
      ).reason
    ).toBe("not_close_friend");
    expect(
      resolveDirectMessageEligibility(
        eligibility({ recipientPermission: "close_friends", senderIsCloseFriendOfRecipient: true })
      ).allowed
    ).toBe(true);
  });

  it("stops a suspended account either way", () => {
    expect(resolveDirectMessageEligibility(eligibility({ senderSuspended: true })).reason).toBe("suspended");
    expect(resolveDirectMessageEligibility(eligibility({ recipientSuspended: true })).reason).toBe("suspended");
  });
});

describe("send permission (spec §20, §27)", () => {
  function send(overrides: Partial<SendMessageInput> = {}): SendMessageInput {
    return {
      conversationStatus: "active",
      memberStatus: "joined",
      role: "member",
      postingMode: "all_members",
      ...overrides
    };
  }

  it("allows a joined member in an active conversation", () => {
    expect(resolveCanSendMessage(send())).toEqual({ allowed: true, reason: "allowed" });
  });

  it("refuses non-members, removed members, and closed conversations", () => {
    expect(resolveCanSendMessage(send({ memberStatus: null })).reason).toBe("not_a_member");
    expect(resolveCanSendMessage(send({ memberStatus: "removed" })).reason).toBe("not_a_member");
    expect(resolveCanSendMessage(send({ memberStatus: "banned" })).reason).toBe("not_a_member");
    expect(resolveCanSendMessage(send({ conversationStatus: "archived" })).reason).toBe("conversation_closed");
  });

  it("enforces admins-only posting", () => {
    expect(resolveCanSendMessage(send({ postingMode: "admins_only", role: "member" })).reason).toBe(
      "posting_restricted"
    );
    expect(resolveCanSendMessage(send({ postingMode: "admins_only", role: "admin" })).allowed).toBe(true);
  });
});

describe("group roles (spec §26)", () => {
  it("scopes capabilities by role", () => {
    expect(canManageGroup("admin")).toBe(true);
    expect(canManageGroup("member")).toBe(false);
    expect(canModerateMessages("moderator")).toBe(true);
    expect(canAssignAdmins("admin")).toBe(false);
    expect(canAssignAdmins("owner")).toBe(true);
  });
});

describe("tier limits (spec §28, §45)", () => {
  it("gives free users the documented caps", () => {
    const free = messagingLimitsFor("free");
    expect(free.maxPrivateGroups).toBe(3);
    expect(free.maxGroupMembers).toBe(15);
    expect(free.maxVoiceNoteSeconds).toBe(60);
  });

  it("never puts voice notes behind a paywall entirely (accessibility, §45)", () => {
    expect(messagingLimitsFor("free").allowVoiceNotes).toBe(true);
  });

  it("bounds voice note duration by plan", () => {
    expect(validateVoiceNoteDuration(90, "free")).toMatch(/60 seconds/);
    expect(validateVoiceNoteDuration(90, "buddy_plus")).toBeNull();
    expect(validateVoiceNoteDuration(0, "free")).toMatch(/too short/);
  });
});

describe("edit / delete windows (spec §13, §14)", () => {
  it("allows editing within 10 minutes, by the sender only", () => {
    const base = { isSender: true, createdAtMs: NOW, nowMs: NOW + 5 * MIN, messageType: "text", deleted: false };
    expect(canEditMessage(base)).toBe(true);
    expect(canEditMessage({ ...base, nowMs: NOW + 11 * MIN })).toBe(false);
    expect(canEditMessage({ ...base, isSender: false })).toBe(false);
    expect(canEditMessage({ ...base, deleted: true })).toBe(false);
  });

  it("never allows editing a server-generated system message", () => {
    expect(
      canEditMessage({ isSender: true, createdAtMs: NOW, nowMs: NOW, messageType: "system", deleted: false })
    ).toBe(false);
  });

  it("bounds delete-for-everyone to the sender and a time window", () => {
    expect(canDeleteForEveryone({ isSender: true, createdAtMs: NOW, nowMs: NOW + 30 * MIN })).toBe(true);
    expect(canDeleteForEveryone({ isSender: true, createdAtMs: NOW, nowMs: NOW + 61 * MIN })).toBe(false);
    expect(canDeleteForEveryone({ isSender: false, createdAtMs: NOW, nowMs: NOW })).toBe(false);
  });
});

describe("read receipts (spec §10)", () => {
  it("shows Seen only when BOTH sides have receipts on", () => {
    expect(senderVisibleState({ status: "read", senderReceiptsEnabled: true, recipientReceiptsEnabled: true })).toBe(
      "seen"
    );
    expect(senderVisibleState({ status: "read", senderReceiptsEnabled: true, recipientReceiptsEnabled: false })).toBe(
      "delivered"
    );
    // Turning your own receipts off also costs you Seen, no one-way peeking.
    expect(senderVisibleState({ status: "read", senderReceiptsEnabled: false, recipientReceiptsEnabled: true })).toBe(
      "delivered"
    );
  });

  it("passes through other states", () => {
    expect(senderVisibleState({ status: "failed", senderReceiptsEnabled: true, recipientReceiptsEnabled: true })).toBe(
      "failed"
    );
    expect(senderVisibleState({ status: "sent", senderReceiptsEnabled: true, recipientReceiptsEnabled: true })).toBe(
      "sent"
    );
  });
});

describe("typing indicator (spec §11)", () => {
  const base = {
    lastTypingAtMs: NOW,
    nowMs: NOW + 1000,
    viewerInConversation: true,
    senderTypingEnabled: true,
    isBlockedEitherDirection: false
  };

  it("shows briefly, then expires", () => {
    expect(shouldShowTypingIndicator(base)).toBe(true);
    expect(shouldShowTypingIndicator({ ...base, nowMs: NOW + 6000 })).toBe(false);
  });

  it("respects the setting, block state, and active conversation", () => {
    expect(shouldShowTypingIndicator({ ...base, senderTypingEnabled: false })).toBe(false);
    expect(shouldShowTypingIndicator({ ...base, isBlockedEitherDirection: true })).toBe(false);
    expect(shouldShowTypingIndicator({ ...base, viewerInConversation: false })).toBe(false);
  });
});

describe("presence (spec §12)", () => {
  it("is coarse and never exposes an exact last-seen", () => {
    expect(resolvePresence({ lastActiveAtMs: NOW, nowMs: NOW + MIN, presenceEnabled: true })).toBe("active_now");
    expect(resolvePresence({ lastActiveAtMs: NOW, nowMs: NOW + 10 * MIN, presenceEnabled: true })).toBe(
      "recently_active"
    );
    expect(resolvePresence({ lastActiveAtMs: NOW, nowMs: NOW + 60 * MIN, presenceEnabled: true })).toBe("hidden");
    expect(resolvePresence({ lastActiveAtMs: NOW, nowMs: NOW, presenceEnabled: false })).toBe("hidden");
  });
});

describe("notification previews (spec §56)", () => {
  it("only includes message text when explicitly opted in", () => {
    expect(buildNotificationPreview({ mode: "sender_and_message", senderName: "Ama", messageText: "secret" })).toEqual({
      title: "Ama",
      body: "secret"
    });
    expect(buildNotificationPreview({ mode: "sender_only", senderName: "Ama", messageText: "secret" })?.body).not.toMatch(
      /secret/
    );
    expect(buildNotificationPreview({ mode: "generic", senderName: "Ama", messageText: "secret" })).toEqual({
      title: "Mad Buddy",
      body: "New message"
    });
    expect(buildNotificationPreview({ mode: "none", senderName: "Ama", messageText: "secret" })).toBeNull();
  });
});

describe("group-add permission (spec §55)", () => {
  const base = {
    areApprovedMuddies: true,
    isBlockedEitherDirection: false,
    targetPermission: "ask_me" as const,
    adderIsCloseFriendOfTarget: false
  };

  it("defaults to requiring consent", () => {
    expect(resolveGroupAdd(base)).toEqual({ allowed: true, requiresConsent: true, reason: "allowed" });
  });

  it("adds directly only when the target allows anyone", () => {
    expect(resolveGroupAdd({ ...base, targetPermission: "anyone" }).requiresConsent).toBe(false);
  });

  it("refuses blocked, non-Muddy, and opted-out targets", () => {
    expect(resolveGroupAdd({ ...base, isBlockedEitherDirection: true }).allowed).toBe(false);
    expect(resolveGroupAdd({ ...base, areApprovedMuddies: false }).allowed).toBe(false);
    expect(resolveGroupAdd({ ...base, targetPermission: "nobody" }).reason).toBe("target_declines");
  });
});

describe("system messages (spec §40)", () => {
  it("renders server-generated plan updates", () => {
    expect(systemMessageText("plan_time_changed", "4:30 PM")).toBe("Plan time changed to 4:30 PM.");
    expect(systemMessageText("plan_cancelled")).toBe("This plan has been cancelled.");
  });
});
