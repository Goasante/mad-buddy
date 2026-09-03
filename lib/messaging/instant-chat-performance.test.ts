import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { beforeEach, describe, expect, it } from "vitest";

import type { ChatMessageView } from "@/lib/messaging/mobile";
import {
  bindThreadCacheOwner,
  clearThreadCache,
  readThread,
  writeThreadMessages
} from "@/lib/messaging/thread-cache";
import {
  MAX_PROACTIVE_WARM_THREADS,
  PROACTIVE_WARM_MESSAGE_LIMIT
} from "@/lib/messaging/thread-warmup";

const VIEWER = "benchmark-viewer";
const CHAT = "benchmark-chat";

function percentile(samples: number[], value: number) {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * value))];
}

beforeEach(() => {
  clearThreadCache();
  bindThreadCacheOwner(VIEWER);
});

describe("instant chat performance contracts", () => {
  it("keeps the proactive download budget below one former 200-row open", () => {
    expect(MAX_PROACTIVE_WARM_THREADS * PROACTIVE_WARM_MESSAGE_LIMIT).toBe(128);
    expect(MAX_PROACTIVE_WARM_THREADS * PROACTIVE_WARM_MESSAGE_LIMIT).toBeLessThan(200);
  });

  it("uses stable canonical ordering and a one-row Realtime projection", () => {
    const service = readFileSync("lib/messaging/mobile.ts", "utf8");
    const actions = readFileSync("app/(app)/messaging-actions.ts", "utf8");

    expect(service).toContain('.order("created_at", { ascending: false })');
    expect(service).toContain('.order("id", { ascending: false })');
    expect(service).toContain('baseQuery.eq("id", options.messageId).limit(1)');
    expect(actions).toContain("{ limit: PROACTIVE_WARM_MESSAGE_LIMIT }");
    expect(actions).toContain("{ messageId }");
  });

  it("reads a 50-message warm thread well inside the 100ms product budget", () => {
    const messages = Array.from({ length: 50 }, (_, index) => ({
      id: `m-${index}`,
      createdAt: new Date(1_700_000_000_000 + index).toISOString(),
      text: `message ${index}`,
      isMine: false,
      clientMessageId: null
    })) as ChatMessageView[];
    writeThreadMessages(VIEWER, CHAT, messages);

    const samples = Array.from({ length: 200 }, () => {
      const started = performance.now();
      expect(readThread(VIEWER, CHAT)?.messages).toHaveLength(50);
      return performance.now() - started;
    });
    const p50 = percentile(samples, 0.5);
    const p95 = percentile(samples, 0.95);

    if (process.env.MESSAGING_PERF_REPORT === "1") {
      console.info(`MESSAGING_CACHE_READ_MS p50=${p50.toFixed(4)} p95=${p95.toFixed(4)}`);
    }
    expect(p95).toBeLessThan(5);
  });

  it("inserts the optimistic bubble before starting network work", () => {
    const composer = readFileSync("components/messaging/message-composer-v3.tsx", "utf8");
    const optimistic = composer.indexOf("onOptimisticSend?.({", composer.indexOf("function sendText()"));
    const network = composer.indexOf("startTransition(async () =>", composer.indexOf("function sendText()"));

    expect(optimistic).toBeGreaterThan(-1);
    expect(network).toBeGreaterThan(optimistic);
  });
});
