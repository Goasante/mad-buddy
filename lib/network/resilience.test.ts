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

  /**
   * A timed-out operation must log distinctly from a slow-but-successful one.
   *
   * THE BUG THIS GUARDS AGAINST: both branches shared one "[performance] slow
   * operation" label, logged unconditionally in a `finally` block that could
   * not see whether the promise it wrapped had actually resolved or been
   * aborted by this module's own timer. A server that stopped responding
   * (found via a corrupted Turbopack dev cache producing repeated backend
   * panics) therefore filled the console with dozens of entries that read as
   * "running a bit slow" — never as "not answering at all" — and that
   * mislabeling sent debugging toward the wrong layer (application code)
   * instead of the actual one (the dev server process itself).
   */
  describe("timeout is logged distinctly from a slow success", () => {
    it("withTimeout: labels a timeout differently from a slow success", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const originalEnv = process.env.NODE_ENV;
      // The finally block's logging is gated on NODE_ENV !== "test"; flip it
      // for this assertion only, since that is the exact branch being tested.
      vi.stubEnv("NODE_ENV", "development");

      vi.useFakeTimers();
      const stalled = withTimeout(new Promise<never>(() => {}), {
        operation: "refresh unread messages",
        timeoutMs: 100
      }).catch(() => {});
      await vi.advanceTimersByTimeAsync(100);
      await stalled;

      expect(warn).toHaveBeenCalledWith(
        "[performance] operation timed out",
        expect.objectContaining({ operation: "refresh unread messages" })
      );
      expect(warn).not.toHaveBeenCalledWith("[performance] slow operation", expect.anything());

      warn.mockClear();
      vi.useRealTimers();

      // A slow SUCCESS, distinct from the timeout above: resolves just under
      // the timeout, well past slowAfterMs.
      await withTimeout(new Promise((resolve) => setTimeout(() => resolve("ok"), 5)), {
        operation: "slow but real",
        timeoutMs: 10_000,
        slowAfterMs: 1
      });

      expect(warn).toHaveBeenCalledWith(
        "[performance] slow operation",
        expect.objectContaining({ operation: "slow but real" })
      );
      expect(warn).not.toHaveBeenCalledWith("[performance] operation timed out", expect.anything());

      vi.stubEnv("NODE_ENV", originalEnv ?? "test");
      warn.mockRestore();
    });

    it("fetchWithTimeout: labels a timeout differently from a slow success", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const originalEnv = process.env.NODE_ENV;
      vi.stubEnv("NODE_ENV", "development");

      vi.useFakeTimers();
      vi.stubGlobal("fetch", vi.fn((_input: RequestInfo | URL, init?: RequestInit) => (
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
        })
      )));

      const settled = fetchWithTimeout("/api/test", {}, 100, "check service worker update").catch(() => {});
      await vi.advanceTimersByTimeAsync(100);
      await settled;

      expect(warn).toHaveBeenCalledWith(
        "[performance] operation timed out",
        expect.objectContaining({ operation: "check service worker update" })
      );
      expect(warn).not.toHaveBeenCalledWith("[performance] slow operation", expect.anything());

      vi.stubEnv("NODE_ENV", originalEnv ?? "test");
      warn.mockRestore();
    });
  });
});
