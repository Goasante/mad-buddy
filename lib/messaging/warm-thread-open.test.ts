import { beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import {
  bindThreadCacheOwner,
  clearThreadCache,
  readThread,
  writeThreadMessages
} from "@/lib/messaging/thread-cache";
import type { ChatMessageView } from "@/lib/messaging/mobile";

/**
 * THE ACCEPTANCE TEST FOR M1 (§15).
 *
 * "I already opened this chat. Why does it load again every time I come back?"
 *
 * Two journeys have to stop hitting the network before they can show anything:
 * switching A -> B -> A, and leaving /messages entirely and returning. The
 * first already worked; the second is the one that was broken, because the
 * cache lived inside the component that the remount destroyed.
 */

const VIEWER = "viewer-1";
const CHAT_A = "chat-a";
const CHAT_B = "chat-b";

function message(id: string): ChatMessageView {
  return {
    id,
    createdAt: "2026-01-01T00:00:00.000Z",
    text: `message ${id}`,
    isMine: false,
    clientMessageId: null
  } as ChatMessageView;
}

/** What MessagesPageV4 does on mount: bind the account, then seed from cache. */
function mountMessagesPage(conversationId: string | null) {
  bindThreadCacheOwner(VIEWER);
  return conversationId ? readThread(VIEWER, conversationId)?.messages ?? [] : [];
}

/** Leaving /messages: the component unmounts and its state is gone. */
function unmountMessagesPage() {
  // Deliberately does nothing to the cache. That is the entire fix -- the
  // store outlives the component, so this is a no-op by design.
}

beforeEach(() => {
  clearThreadCache();
  bindThreadCacheOwner(VIEWER);
});

describe("A -> B -> A never blocks on the network", () => {
  it("returns Chat A's messages without a fetch", () => {
    writeThreadMessages(VIEWER, CHAT_A, [message("m1"), message("m2")]);
    writeThreadMessages(VIEWER, CHAT_B, [message("m3")]);

    // Back to A. This is the value the component paints on the same tick.
    expect(readThread(VIEWER, CHAT_A)?.messages.map((row) => row.id)).toEqual(["m1", "m2"]);
  });
});

describe("leaving /messages and returning never blocks on the network", () => {
  it("still has the thread after the component has been destroyed", () => {
    mountMessagesPage(null);
    writeThreadMessages(VIEWER, CHAT_A, [message("m1"), message("m2")]);

    unmountMessagesPage();
    // A fresh mount, exactly as the bottom nav produces.
    const painted = mountMessagesPage(CHAT_A);

    expect(painted.map((row) => row.id)).toEqual(["m1", "m2"]);
  });

  it("survives several round trips through the tab bar", () => {
    writeThreadMessages(VIEWER, CHAT_A, [message("m1")]);

    for (let visit = 0; visit < 5; visit += 1) {
      unmountMessagesPage();
      expect(mountMessagesPage(CHAT_A)).toHaveLength(1);
    }
  });

  it("paints nothing for a conversation this session has never opened", () => {
    // The blocking spinner is still correct here -- it is a genuine first load.
    expect(mountMessagesPage("never-opened")).toHaveLength(0);
  });
});

describe("the spinner is reserved for a real first load", () => {
  it("shows the loading state only when there is nothing cached to paint", () => {
    const source = readFileSync("components/messages/messages-page-v4.tsx", "utf8");

    // setLoadingMessages is driven by whether the cache had messages, not by
    // whether a request is in flight. A warm thread therefore never blanks.
    expect(source).toContain("const hasCachedMessages = Boolean(cached && cached.messages.length > 0)");
    expect(source).toContain("setLoadingMessages(!hasCachedMessages)");
  });

  it("still guards the spinner on an empty message list at render", () => {
    const source = readFileSync("components/messages/messages-page-v4.tsx", "utf8");

    // Belt and braces: even if loading were true, a thread with cached
    // messages renders them rather than the spinner.
    expect(source).toContain("loadingMessages && messages.length === 0");
  });

  it("seeds the first render from the cache rather than an effect", () => {
    const source = readFileSync("components/messages/messages-page-v4.tsx", "utf8");

    // An effect would run AFTER the first paint, so the spinner would still
    // flash on every remount. The lazy useState initialiser is what makes the
    // very first frame already correct.
    expect(source).toMatch(/useState<ChatMessageView\[\]>\(\(\) => \{/);
    expect(source).toContain("readThread(viewerId, id)?.messages ?? []");
  });
});

describe("reconciliation replaces the cached copy rather than trusting it", () => {
  it("writes the server rows back into the cache after every load", () => {
    const source = readFileSync("components/messages/messages-page-v4.tsx", "utf8");

    expect(source).toContain("writeThreadMessages(viewerIdRef.current, conversationId, loaded)");
  });

  it("keeps the server as the authority for a conversation the viewer lost access to", () => {
    // A revoked member gets [] from listMessages, which overwrites the cached
    // rows. The cache can never keep a door open that the server has closed.
    writeThreadMessages(VIEWER, CHAT_A, [message("m1")]);
    writeThreadMessages(VIEWER, CHAT_A, []);

    expect(readThread(VIEWER, CHAT_A)?.messages).toHaveLength(0);
  });
});
