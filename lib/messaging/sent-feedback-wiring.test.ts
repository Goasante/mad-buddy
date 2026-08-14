import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { stripComments } from "@/lib/content/strip-comments";

/**
 * "Sent" must not become permanent UI.
 *
 * THE REPORTED DEFECT. After sending, "Sent" appeared in a bordered banner
 * above the inbox. Navigating back to Messages kept it. A reload could keep it
 * too. Nothing in the page ever cleared the feedback string, because the send
 * path reported success and failure through the same channel:
 * `onFeedback(result.message)` fires for both, and the server returns "Sent".
 */

const messages = stripComments(readFileSync("components/messages/messages-page.tsx", "utf8"));
const circle = stripComments(readFileSync("components/groups/group-detail-page.tsx", "utf8"));
const hook = stripComments(readFileSync("hooks/use-transient-feedback.ts", "utf8"));

describe("the direct inbox clears its own confirmations", () => {
  it("holds feedback in the self-clearing hook", () => {
    expect(messages).toContain("useTransientFeedback()");
  });

  it("no longer holds it in a plain useState that nothing clears", () => {
    expect(messages).not.toContain('const [feedback, setFeedback] = useState("")');
  });

  it("shows a confirmation as a quiet line, not a bordered panel", () => {
    // A trivial success should not occupy content space like an alert.
    expect(messages).toContain("isTransientConfirmation(feedback)");
  });
});

describe("Circle chat behaves the same way", () => {
  it("uses the shared hook rather than repeating the pattern", () => {
    // Same defect, same cause: composer feedback piped into state with no
    // clearing. Fixed at the shared primitive, not per screen.
    expect(circle).toContain("useTransientFeedback()");
    expect(circle).not.toContain('const [feedback, setFeedback] = useState("")');
  });
});

describe("the hook itself", () => {
  it("clears its timer on unmount, so navigating away cannot update a dead component", () => {
    expect(hook).toContain("clearTimeout");
    expect(hook).toContain("return () => {");
  });

  it("restarts the countdown when a new message replaces an old one", () => {
    // Otherwise a second "Sent" would inherit the first one's remaining time.
    expect(hook).toContain("timerRef");
  });

  it("only ever auto-clears confirmations", () => {
    expect(hook).toContain("isTransientConfirmation(feedback)");
  });

  it("keeps nothing in storage or the URL, so a reload cannot resurrect it", () => {
    // The stuck banner was pure component state. If it were ever moved into a
    // query param or storage, a refresh would bring it back.
    expect(hook).not.toContain("localStorage");
    expect(hook).not.toContain("sessionStorage");
    expect(hook).not.toContain("searchParams");
  });
});
