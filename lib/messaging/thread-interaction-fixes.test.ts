import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * Two reported defects in the open conversation.
 *
 * 1. "You can't delete a message. It asks delete for everyone or yourself and
 *    nothing happens again."
 * 2. "Instead of it being scrolled up and down, it moves sideways as well."
 *
 * Both were presentation faults rather than broken logic, which is exactly why
 * they were invisible to the existing suites -- the delete request was being
 * sent and answered correctly the whole time. These assertions pin the fixes to
 * the source so a later refactor cannot quietly reintroduce either.
 */

const page = () => readFileSync("components/messages/messages-page-v4.tsx", "utf8");
const bubble = () => readFileSync("components/messaging/message-bubble-v4.tsx", "utf8");

describe("the thread scrolls vertically only", () => {
  it("clamps the horizontal axis on the scroll container", () => {
    // A bubble parks its reply icon 42px outside its own left edge and
    // translates right while dragging. Without this clamp both widen the
    // scrollable area and the whole thread pans sideways.
    expect(page()).toContain("overflow-y-auto overflow-x-hidden overscroll-contain");
  });

  it("still lets the swipe-to-reply icon render outside the bubble", () => {
    // The fix belongs on the scroll container, not the bubble: clipping here
    // would hide the affordance the gesture exists to show.
    expect(bubble()).toContain('style={{ transform: "translateX(-42px)" }}');
    expect(bubble()).not.toContain("[overflow-x:clip]");
  });
});

describe("a delete visibly resolves", () => {
  it("closes the sheet before waiting on the server", () => {
    const source = page();
    const handler = source.slice(source.indexOf("<DeleteMessageModal"));
    const body = handler.slice(0, handler.indexOf("}} />"));

    // The sheet used to stay open for the whole round trip, which is most of
    // what "nothing happens" meant.
    expect(body.indexOf("setDeleteTarget(null)")).toBeLessThan(body.indexOf("await deleteMessageAction"));
  });

  it("removes the message immediately rather than waiting for a refetch", () => {
    const source = page();
    const handler = source.slice(source.indexOf("<DeleteMessageModal"));
    const body = handler.slice(0, handler.indexOf("}} />"));

    expect(body).toContain("current.filter((message) => message.id !== messageId)");
    expect(body.indexOf("current.filter")).toBeLessThan(body.indexOf("await deleteMessageAction"));
  });

  it("puts the message back when the server refuses", () => {
    const source = page();
    const handler = source.slice(source.indexOf("<DeleteMessageModal"));
    const body = handler.slice(0, handler.indexOf("}} />"));

    // "Delete for everyone" is refused outside its one-hour window. A refused
    // delete must not leave the message looking deleted.
    expect(body).toContain("setMessages(previousMessages)");
  });

  it("deletes into the conversation it started in", () => {
    const source = page();
    const handler = source.slice(source.indexOf("<DeleteMessageModal"));
    const body = handler.slice(0, handler.indexOf("}} />"));

    // Captured up front, so a thread switch mid-request cannot redirect the
    // follow-up refresh at the wrong conversation.
    expect(body).toContain("const conversationId = selectedId;");
  });
});

describe("what the product says is where the person can see it", () => {
  it("floats the feedback banner above the full-screen thread", () => {
    const source = page();
    const banner = source.slice(source.indexOf("{feedback ? ("));

    // An open conversation is `fixed inset-0 z-30`. A banner in normal flow
    // renders behind it, so every delete outcome was silently swallowed.
    expect(banner.slice(0, 600)).toContain("fixed");
    expect(banner.slice(0, 600)).toContain("z-40");
  });

  it("keeps the thread overlay below the banner", () => {
    expect(page()).toContain("fixed inset-0 z-30");
  });

  it("lets confirmations expire instead of pinning them over the thread", () => {
    // A permanent banner would now cover the conversation. The existing hook
    // expires confirmations and keeps failures until they are dealt with.
    expect(page()).toContain("useTransientFeedback()");
  });
});

describe("a hide that fails is reported as a failure", () => {
  it("checks the error from the delete-for-me write", () => {
    const source = readFileSync("app/(app)/messaging-actions.ts", "utf8");
    const action = source.slice(source.indexOf("export async function deleteMessageAction"));
    const body = action.slice(0, action.indexOf("\nexport "));

    // The error used to be discarded, so a failed hide still reported success
    // and the message reappeared on the next refresh with no explanation.
    expect(body).toContain("const { error: hideError }");
    expect(body).toContain("if (hideError) return { ok: false");
  });
});
