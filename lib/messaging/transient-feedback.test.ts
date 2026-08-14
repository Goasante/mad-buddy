import { describe, expect, it } from "vitest";
import { isTransientConfirmation, TRANSIENT_FEEDBACK_MS } from "@/hooks/use-transient-feedback";

/**
 * A confirmation must not become permanent UI.
 *
 * The reported defect: "Sent" appeared after sending a message, survived
 * navigating back to Messages, and could still be on screen after a reload.
 * The classifier below is what decides whether a message is allowed to expire.
 */

describe("confirmations expire", () => {
  const confirmations = [
    "Sent",
    "Saved",
    "Updated",
    "Copied",
    "Removed",
    "Deleted",
    "Published",
    "Joined",
    "Message sent",
    "Your plan was created",
    "Pinned",
    "Muted"
  ];

  for (const message of confirmations) {
    it(`treats "${message}" as transient`, () => {
      expect(isTransientConfirmation(message)).toBe(true);
    });
  }
});

describe("errors stay until the person deals with them", () => {
  const failures = [
    "The message could not be sent. Try again.",
    "Sending took too long. Your message was kept so you can try again.",
    "Messages took too long to respond. Try again.",
    "That image couldn't be read. Try another one.",
    "You cannot message this person.",
    "Something went wrong.",
    "That action failed.",
    "Access denied.",
    "That username is invalid.",
    "A cover image is required before publishing.",
    "That conversation is no longer available.",
    "You are already a member."
  ];

  for (const message of failures) {
    it(`keeps "${message.slice(0, 38)}…" on screen`, () => {
      expect(isTransientConfirmation(message)).toBe(false);
    });
  }
});

describe("classification is fail-safe", () => {
  it("keeps an unrecognised message rather than hiding it", () => {
    // Wrongly keeping a confirmation is a blemish. Wrongly hiding a failure
    // loses information the person needed, so unknown tone must NOT expire.
    expect(isTransientConfirmation("Quota exceeded for this operation")).toBe(false);
  });

  it("treats an empty message as nothing to show", () => {
    expect(isTransientConfirmation("")).toBe(false);
  });

  it("is case-insensitive about failure wording", () => {
    expect(isTransientConfirmation("COULD NOT SEND")).toBe(false);
    expect(isTransientConfirmation("Failed")).toBe(false);
  });
});

describe("timing", () => {
  it("uses the interval the app already used by hand", () => {
    // moments-page and profile-page both hand-rolled setTimeout(..., 4000)
    // before this hook existed; adopting a different number would make the
    // same confirmation last two different lengths depending on the screen.
    expect(TRANSIENT_FEEDBACK_MS).toBe(4000);
  });

  it("is short enough to feel transient", () => {
    expect(TRANSIENT_FEEDBACK_MS).toBeLessThanOrEqual(5000);
  });
});
