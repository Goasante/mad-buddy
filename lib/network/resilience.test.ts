import { afterEach, describe, expect, it, vi } from "vitest";
import {
  RequestTimeoutError,
  fetchWithTimeout,
  isRequestTimeoutError,
  withTimeout
} from "@/lib/network/resilience";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("network resilience", () => {
  it("returns a completed operation and clears its timeout", async () => {
    vi.useFakeTimers();
    await expect(
      withTimeout(Promise.resolve("ready"), {
        operation: "test operation",
        timeoutMs: 100
      })
    ).resolves.toBe("ready");

    expect(vi.getTimerCount()).toBe(0);
  });

  it("rejects a stalled operation with a safe timeout error", async () => {
    vi.useFakeTimers();
    const result = withTimeout(new Promise<never>(() => {}), {
      operation: "stalled operation",
      timeoutMs: 100
    });
    const assertion = expect(result).rejects.toBeInstanceOf(RequestTimeoutError);

    await vi.advanceTimersByTimeAsync(100);
    await assertion;
  });

  it("aborts a stalled fetch and identifies the timeout", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn((_input: RequestInfo | URL, init?: RequestInit) => (
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("Aborted", "AbortError"));
        });
      })
    )));

    // Attach the rejection handler synchronously, BEFORE advancing timers fires
    // the abort — otherwise the rejection is momentarily unhandled and vitest
    // flags it (which can cause false positives elsewhere in the run).
    const settled = fetchWithTimeout("/api/test", {}, 100, "test fetch").catch(
      (caught: unknown) => caught
    );
    await vi.advanceTimersByTimeAsync(100);
    const error = await settled;
    expect(isRequestTimeoutError(error)).toBe(true);
  });
});
