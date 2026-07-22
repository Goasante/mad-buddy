import { afterEach, describe, expect, it, vi } from "vitest";
import { dismissAllOverlays, dismissTopOverlay, hasOpenOverlay, pushOverlay, removeOverlay } from "./overlay";

afterEach(() => dismissAllOverlays());

describe("overlay stack (shared dropdown/sheet dismissal)", () => {
  it("dismisses the most-recently-opened overlay first (Android back / Escape)", () => {
    const first = vi.fn();
    const second = vi.fn();
    pushOverlay(first);
    pushOverlay(second);

    expect(dismissTopOverlay()).toBe(true);
    expect(second).toHaveBeenCalledOnce();
    expect(first).not.toHaveBeenCalled();

    expect(dismissTopOverlay()).toBe(true);
    expect(first).toHaveBeenCalledOnce();
  });

  it("returns false when nothing is open, so back navigates instead of being swallowed", () => {
    expect(hasOpenOverlay()).toBe(false);
    expect(dismissTopOverlay()).toBe(false);
  });

  it("dismissAllOverlays enforces one-open-at-a-time when a new dropdown opens", () => {
    const a = vi.fn();
    const b = vi.fn();
    pushOverlay(a);
    pushOverlay(b);
    dismissAllOverlays();
    expect(a).toHaveBeenCalledOnce();
    expect(b).toHaveBeenCalledOnce();
    expect(hasOpenOverlay()).toBe(false);
  });

  it("removeOverlay unregisters a closed overlay without dismissing others", () => {
    const a = vi.fn();
    const b = vi.fn();
    const idA = pushOverlay(a);
    pushOverlay(b);
    removeOverlay(idA);
    expect(a).not.toHaveBeenCalled();
    expect(dismissTopOverlay()).toBe(true);
    expect(b).toHaveBeenCalledOnce();
    expect(hasOpenOverlay()).toBe(false);
  });
});
