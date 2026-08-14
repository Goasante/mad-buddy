import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { stripComments } from "@/lib/content/strip-comments";

/**
 * The reported dead end, pinned so it cannot come back.
 *
 * WHAT THE USER SAW. Messages badge said 6, the inbox looked empty. Tapping
 * New Message and choosing a Muddy led nowhere. Closing and reopening the app
 * made the conversations appear.
 *
 * WHY. Choosing a Muddy set `selectedId`, which is what makes the thread pane
 * go fullscreen on mobile. But `selected` was looked up in the list the server
 * had rendered BEFORE the conversation existed, so it was null and the pane
 * rendered "Select a conversation -- Choose a Muddy to view your
 * conversation." over a hidden inbox: the person had just chosen a Muddy and
 * was being asked to choose one, with nothing to tap.
 *
 * The list could not fix itself either. `conversations` came from a useState
 * initialiser, which ignores later props, and every writer was a `.map()` over
 * existing rows -- not one could ADD a row. Only a fresh page load could.
 */

const read = (path: string) => readFileSync(path, "utf8");
const page = read("components/messages/messages-page.tsx");
const source = stripComments(page);

describe("choosing a Muddy ends somewhere", () => {
  it("puts the conversation into client state instead of only refreshing the route", () => {
    // router.refresh() re-renders the server component; it cannot write this
    // client list, which is why the old flow dead-ended.
    expect(source).toContain("syncConversations");
  });

  it("marks a just-created conversation pending before opening it", () => {
    // Without this an in-flight list fetch, which predates the conversation,
    // would delete the row the moment it landed.
    expect(source).toContain("pendingConversationIds.current.add(conversationId)");
  });

  it("opens the thread for the id the server returned", () => {
    expect(source).toContain("openConversation(conversationId)");
  });

  it("reconciles the canonical list rather than inventing a row locally", () => {
    // A hand-built row would be a second source of truth for titles, avatars
    // and unread counts. getConversationsAction is the same server read that
    // produced initialConversations.
    expect(source).toContain("getConversationsAction()");
  });
});

describe("the fullscreen pane always offers a way out", () => {
  it("does not tell someone to choose a Muddy after they chose one", () => {
    // The exact trap: selectedId set (pane fullscreen) with selected null.
    // "Select a conversation" must be reachable ONLY when nothing is selected.
    const pane = source.slice(source.indexOf("{!selected ?"), source.indexOf("Back to conversations"));
    expect(pane).toContain("selectedId ?");
  });

  it("shows progress while the row is still arriving", () => {
    expect(source).toContain("Opening conversation…");
  });

  it("offers an escape from the fullscreen pane", () => {
    expect(source).toContain("Back to conversations");
  });
});

describe("state converges without restarting the app", () => {
  it("re-syncs when the app returns to the foreground", () => {
    // Closing and reopening the app was the user's workaround; it worked
    // because it re-ran the server load by hand.
    expect(source).toContain('addEventListener("visibilitychange"');
    expect(source).toContain('addEventListener("focus"');
  });

  it("removes both listeners when the page unmounts", () => {
    expect(source).toContain('removeEventListener("visibilitychange"');
    expect(source).toContain('removeEventListener("focus"');
  });

  it("only re-syncs when actually visible", () => {
    expect(source).toContain('document.visibilityState === "visible"');
  });

  it("refreshes the inbox after sending, so the row is not left stale", () => {
    const send = source.slice(source.indexOf("function sendQuickAction"));
    expect(send.slice(0, send.indexOf("function updateMessageAttachment"))).toContain("syncConversations");
  });
});

describe("a deep link is not a dead end either", () => {
  it("fetches the list for an id the page was not rendered with", () => {
    const openEffect = source.slice(
      source.indexOf("if (openedRequestedConversation.current"),
      source.indexOf("useEffect(() => {", source.indexOf("if (openedRequestedConversation.current"))
    );
    expect(openEffect).toContain("syncConversations");
  });
});
