import { beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import {
  bindThreadCacheOwner,
  clearThreadCache,
  readThread,
  writeThreadOptimistic
} from "@/lib/messaging/thread-cache";
import { markFailed, markRetrying, pruneConfirmed, type OptimisticMessage } from "@/lib/messaging/optimistic-messages";

/**
 * THE ACCEPTANCE TEST FOR M2 (§14).
 *
 * Send in Chat A, switch immediately to Chat B, come back. The outgoing row
 * must still be coherent whether the server succeeded, is still working, or
 * failed. A failure especially must never vanish: it is the one case where the
 * person has lost words they wrote and cannot tell.
 *
 * The scenarios below drive the same store and the same pure reconciliation
 * helpers the component uses, in the same order the component calls them.
 */

const VIEWER = "viewer-1";
const CHAT_A = "chat-a";
const CHAT_B = "chat-b";

function outgoing(clientMessageId: string): OptimisticMessage {
  return {
    clientMessageId,
    text: "See you at 7",
    kind: "text",
    durationSeconds: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    status: "pending"
  };
}

/** What the component does on tapping another conversation. */
function switchTo(conversationId: string) {
  return readThread(VIEWER, conversationId);
}

beforeEach(() => {
  clearThreadCache();
  bindThreadCacheOwner(VIEWER);
});

describe("A - the server accepts the message", () => {
  it("reconciles the outgoing row into the canonical one, showing it once", () => {
    writeThreadOptimistic(VIEWER, CHAT_A, [outgoing("c1")]);
    switchTo(CHAT_B);

    // The send lands while the person is reading Chat B.
    const settled = markRetrying(readThread(VIEWER, CHAT_A)?.optimistic ?? [], "c1");
    writeThreadOptimistic(VIEWER, CHAT_A, settled);

    // Back in Chat A, the server's own row has arrived carrying the same key.
    const canonical = [{ clientMessageId: "c1", createdAt: "2026-01-01T00:00:00.000Z" }];
    const drawn = pruneConfirmed(readThread(VIEWER, CHAT_A)?.optimistic ?? [], canonical);

    expect(drawn).toHaveLength(0);
  });
});

describe("B - the server has not answered yet", () => {
  it("keeps the pending row waiting in its own thread", () => {
    writeThreadOptimistic(VIEWER, CHAT_A, [outgoing("c1")]);
    switchTo(CHAT_B);

    const back = switchTo(CHAT_A);

    expect(back?.optimistic).toHaveLength(1);
    expect(back?.optimistic[0].status).toBe("pending");
  });

  it("does not draw Chat A's pending row inside Chat B", () => {
    writeThreadOptimistic(VIEWER, CHAT_A, [outgoing("c1")]);

    expect(switchTo(CHAT_B)?.optimistic ?? []).toHaveLength(0);
  });
});

describe("C - the server fails", () => {
  it("keeps the failed row, so the message is never silently lost", () => {
    writeThreadOptimistic(VIEWER, CHAT_A, [outgoing("c1")]);
    switchTo(CHAT_B);

    // The failure arrives while the person is elsewhere.
    writeThreadOptimistic(VIEWER, CHAT_A, markFailed(readThread(VIEWER, CHAT_A)?.optimistic ?? [], "c1"));

    const back = switchTo(CHAT_A);
    expect(back?.optimistic).toHaveLength(1);
    expect(back?.optimistic[0].status).toBe("failed");
    expect(back?.optimistic[0].text).toBe("See you at 7");
  });

  it("still shows the failed row when unrelated server rows exist", () => {
    writeThreadOptimistic(VIEWER, CHAT_A, [{ ...outgoing("c1"), status: "failed" }]);

    // pruneConfirmed drops only CONFIRMED rows. A failed send has no canonical
    // row to become, so removing it would delete what the person wrote.
    const drawn = pruneConfirmed(readThread(VIEWER, CHAT_A)?.optimistic ?? [], [
      { clientMessageId: "unrelated", createdAt: "2026-01-01T00:02:00.000Z" }
    ]);

    expect(drawn).toHaveLength(1);
    expect(drawn[0].status).toBe("failed");
  });
});

/**
 * Reads one top-level function body out of the component source.
 *
 * Brace-matched rather than sliced to the next "  }", because several of these
 * functions contain nested blocks at that indentation and a naive slice
 * silently swallows the rest of the file -- which makes the assertion below
 * pass or fail on unrelated code.
 */
function functionBody(source: string, declaration: string): string {
  const start = source.indexOf(declaration);
  if (start < 0) throw new Error(`${declaration} not found`);
  const open = source.indexOf("{", start);
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    else if (source[index] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(open, index + 1);
    }
  }
  throw new Error(`unbalanced braces in ${declaration}`);
}

describe("retry cannot duplicate a message the server already took", () => {
  it("retries under the original idempotency key", () => {
    const source = readFileSync("components/messages/messages-page-v4.tsx", "utf8");
    const body = functionBody(source, "function retryOptimistic");

    // The same clientMessageId is sent back, so the server's unique
    // (sender_id, client_message_id) returns the original message instead of
    // inserting a second one.
    expect(body).toContain("clientMessageId");
    expect(body).not.toContain("randomUUID");
  });

  it("retries into the message's own conversation, not the selected one", () => {
    const source = readFileSync("components/messages/messages-page-v4.tsx", "utf8");
    const body = functionBody(source, "function retryOptimistic");

    expect(body).toContain("draft.conversationId");
    expect(body).not.toContain("conversationId: selectedId");
  });
});

describe("the destructive reset is gone", () => {
  it("openConversation no longer clears outgoing state", () => {
    const source = readFileSync("components/messages/messages-page-v4.tsx", "utf8");
    const body = functionBody(source, "function openConversation");

    expect(body).not.toContain("setOptimistic([])");
  });

  it("outgoing state is keyed by conversation rather than flat", () => {
    const source = readFileSync("components/messages/messages-page-v4.tsx", "utf8");

    expect(source).toContain("optimisticByConversation");
    expect(source).not.toMatch(/useState<OptimisticMessage\[\]>\(\[\]\)/);
  });
});
