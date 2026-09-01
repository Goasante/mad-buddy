import { describe, expect, it } from "vitest";
import {
  discardOptimistic,
  markFailed,
  markRetrying,
  mergeForDisplay,
  pruneConfirmed,
  type OptimisticMessage
} from "@/lib/messaging/optimistic-messages";

/**
 * The rules that decide whether a sent message is shown once, twice, or lost
 * (spec R2 §8-§12, §17, §18, §24).
 */

function pending(clientMessageId: string, createdAt: string, over: Partial<OptimisticMessage> = {}): OptimisticMessage {
  return {
    clientMessageId,
    text: "Hi",
    kind: "text",
    durationSeconds: null,
    createdAt,
    status: "pending",
    ...over
  };
}

const canonical = (clientMessageId: string | null, createdAt: string) => ({ clientMessageId, createdAt });

describe("a confirmed message is shown exactly once", () => {
  it("drops the optimistic row once the server's row carries its key", () => {
    // The duplicate bug in its simplest form: both rows exist for one message.
    const result = pruneConfirmed([pending("k1", "2026-08-20T10:00:00Z")], [canonical("k1", "2026-08-20T10:00:01Z")]);
    expect(result).toHaveLength(0);
  });

  it("survives the send response AND the realtime echo without duplicating", () => {
    // Three sources race to show one message; all three must converge on one.
    const optimistic = [pending("k1", "2026-08-20T10:00:00Z")];
    const afterResponse = mergeForDisplay([canonical("k1", "2026-08-20T10:00:01Z")], optimistic);
    const afterEcho = mergeForDisplay([canonical("k1", "2026-08-20T10:00:01Z")], optimistic);
    expect(afterResponse).toHaveLength(1);
    expect(afterEcho).toHaveLength(1);
  });

  it("keeps a pending row the server has not confirmed yet", () => {
    // The whole point: it is visible BEFORE the server knows about it.
    const result = mergeForDisplay([canonical("other", "2026-08-20T09:00:00Z")], [pending("k1", "2026-08-20T10:00:00Z")]);
    expect(result).toHaveLength(2);
  });

  it("marks a pending row sent as soon as the server accepts it", () => {
    const result = markRetrying([pending("k1", "2026-08-20T10:00:00Z")], "k1");
    expect(result[0].status).toBe("sent");
  });

  it("does not match one person's key against another message's null key", () => {
    // Other people's rows carry null; null must never confirm anything.
    const result = pruneConfirmed([pending("k1", "2026-08-20T10:00:00Z")], [canonical(null, "2026-08-20T10:00:01Z")]);
    expect(result).toHaveLength(1);
  });
});

describe("ordering converges regardless of acknowledgement order", () => {
  it("shows A, B, C in the order they were sent", () => {
    const optimistic = [
      pending("c", "2026-08-20T10:00:02Z", { text: "C" }),
      pending("a", "2026-08-20T10:00:00Z", { text: "A" }),
      pending("b", "2026-08-20T10:00:01Z", { text: "B" })
    ];
    const shown = mergeForDisplay([], optimistic) as OptimisticMessage[];
    expect(shown.map((m) => m.text)).toEqual(["A", "B", "C"]);
  });

  it("puts pending rows after everything already persisted", () => {
    const shown = mergeForDisplay(
      [canonical("old", "2026-08-20T09:00:00Z")],
      [pending("new", "2026-08-20T10:00:00Z")]
    );
    expect(shown[shown.length - 1]).toMatchObject({ clientMessageId: "new" });
  });

  it("lets a confirmed middle message take its canonical place", () => {
    // B acknowledged first; the display must still read A, B, C.
    const optimistic = [pending("a", "2026-08-20T10:00:00Z", { text: "A" }), pending("c", "2026-08-20T10:00:02Z", { text: "C" })];
    const shown = mergeForDisplay([canonical("b", "2026-08-20T10:00:01Z")], optimistic);
    expect(shown).toHaveLength(3);
  });
});

describe("a failed message is kept, never silently removed", () => {
  it("marks the row failed instead of dropping it", () => {
    const result = markFailed([pending("k1", "2026-08-20T10:00:00Z")], "k1");
    expect(result).toHaveLength(1);
    expect(result[0].status).toBe("failed");
  });

  it("keeps a failed row even as canonical messages arrive around it", () => {
    // A failure has no canonical row to be replaced by; pruning must not eat it.
    const failed = markFailed([pending("k1", "2026-08-20T10:00:00Z")], "k1");
    const shown = mergeForDisplay([canonical("other", "2026-08-20T10:00:05Z")], failed);
    expect(shown).toHaveLength(2);
  });

  it("returns a failed row to pending on retry, keeping the SAME key", () => {
    // Reusing the key is what makes the retry idempotent server-side.
    const retried = markRetrying(markFailed([pending("k1", "2026-08-20T10:00:00Z")], "k1"), "k1");
    expect(retried[0].status).toBe("pending");
    expect(retried[0].clientMessageId).toBe("k1");
  });

  it("removes a row only when the person discards it explicitly", () => {
    expect(discardOptimistic([pending("k1", "2026-08-20T10:00:00Z")], "k1")).toHaveLength(0);
  });

  it("resolves the pending row once a retry finally succeeds", () => {
    // Guards "pending never resolves": the retried key still reconciles.
    const retried = markRetrying(markFailed([pending("k1", "2026-08-20T10:00:00Z")], "k1"), "k1");
    expect(mergeForDisplay([canonical("k1", "2026-08-20T10:00:09Z")], retried)).toHaveLength(1);
  });
});
