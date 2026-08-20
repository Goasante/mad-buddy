import { describe, expect, it } from "vitest";
import {
  resolveDirectMessageEligibility,
  type DirectMessageEligibilityInput
} from "@/lib/messaging/rules";

/**
 * A Linkr conversation must accept messages (spec R2 §27).
 *
 * THE REPORTED DEFECT, reproduced against the running app before this fix:
 * two people Connect on Linkr, the connection creates a real direct
 * conversation, "Say hi" opens it -- and every send is refused with "You can't
 * message this person." Voice failed the same way one step earlier, because
 * the upload intent is gated by the same check, which is why the composer
 * reported "That conversation isn't available." rather than anything about
 * audio.
 *
 * ROOT CAUSE. `canSendMessage` re-runs `canCreateDirectConversation` on every
 * direct send, and that gate required approved-Muddy status. Linkr's whole
 * premise is a pair who chose each other WITHOUT being Muddies, so the
 * conversation it legitimately created could never be used.
 *
 * These tests are on the pure resolver, so they bite on the RULE rather than
 * on the wiring, and cannot pass by accident if the lookup is later moved.
 */

function eligibility(overrides: Partial<DirectMessageEligibilityInput> = {}): DirectMessageEligibilityInput {
  return {
    areApprovedMuddies: false,
    hasActiveLinkrConnection: false,
    isBlockedEitherDirection: false,
    recipientPermission: "all_muddies",
    senderIsCloseFriendOfRecipient: false,
    senderSharesSelectedCircle: false,
    recipientSuspended: false,
    senderSuspended: false,
    ...overrides
  };
}

describe("a Linkr connection is its own basis for messaging", () => {
  it("allows a send between two people who connected but are not Muddies", () => {
    // The exact production case: no friendship, an active connection.
    const result = resolveDirectMessageEligibility(
      eligibility({ areApprovedMuddies: false, hasActiveLinkrConnection: true })
    );
    expect(result.allowed).toBe(true);
  });

  it("still refuses two strangers with neither relationship", () => {
    // The guarantee that the fix widened the gate rather than removed it.
    const result = resolveDirectMessageEligibility(eligibility());
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("not_muddies");
  });

  it("keeps working for ordinary Muddies who never used Linkr", () => {
    const result = resolveDirectMessageEligibility(eligibility({ areApprovedMuddies: true }));
    expect(result.allowed).toBe(true);
  });
});

describe("a connection does not outrank blocking or suspension", () => {
  it("refuses when either side has blocked the other", () => {
    // Blocking must win over every relationship, or blocking means nothing.
    const result = resolveDirectMessageEligibility(
      eligibility({ hasActiveLinkrConnection: true, isBlockedEitherDirection: true })
    );
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("blocked");
  });

  it("refuses when either account is suspended", () => {
    const result = resolveDirectMessageEligibility(
      eligibility({ hasActiveLinkrConnection: true, recipientSuspended: true })
    );
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("suspended");
  });
});

describe("a connection is a direct choice, so audience preferences do not veto it", () => {
  /**
   * These preferences answer "which of my MUDDIES may reach me". They were
   * never asked about someone the recipient personally Connected with, so
   * applying them here would silently void a connection just made -- the pair
   * would see a conversation they cannot use, which is the original bug in a
   * quieter form.
   */
  it("allows the send even when the recipient accepts only close friends", () => {
    const result = resolveDirectMessageEligibility(
      eligibility({ hasActiveLinkrConnection: true, recipientPermission: "close_friends" })
    );
    expect(result.allowed).toBe(true);
  });

  it("allows the send even when the recipient accepts only selected Circles", () => {
    const result = resolveDirectMessageEligibility(
      eligibility({ hasActiveLinkrConnection: true, recipientPermission: "selected_circles" })
    );
    expect(result.allowed).toBe(true);
  });

  it("still refuses a NON-connected sender under those same preferences", () => {
    // Proves the exemption is scoped to the connection, not to everybody.
    expect(
      resolveDirectMessageEligibility(
        eligibility({ areApprovedMuddies: true, recipientPermission: "close_friends" })
      ).allowed
    ).toBe(false);
  });
});
