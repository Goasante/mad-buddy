import { describe, expect, it, beforeEach } from "vitest";
import { loadQuickActionsPosition, saveQuickActionsPosition } from "@/lib/navigation/quick-actions-position";

/**
 * lib/**\/*.test.ts runs under the "node" environment (see vitest.config.ts),
 * so there is no real window/localStorage here. A minimal in-memory stand-in
 * is enough: the module under test only calls getItem/setItem, and this keeps
 * the suite fast without pulling jsdom into every lib test.
 */
function installFakeLocalStorage() {
  const store = new Map<string, string>();
  (globalThis as { window?: unknown }).window = {
    localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
      clear: () => store.clear()
    }
  };
}

describe("Quick Actions floating position", () => {
  beforeEach(() => {
    installFakeLocalStorage();
  });

  it("returns null when nothing is stored", () => {
    expect(loadQuickActionsPosition()).toBeNull();
  });

  it("round-trips a saved position", () => {
    saveQuickActionsPosition({ edge: "left", verticalFraction: 0.42 });
    expect(loadQuickActionsPosition()).toEqual({ edge: "left", verticalFraction: 0.42 });
  });

  it("clamps a stored fraction outside 0-1", () => {
    window.localStorage.setItem(
      "mad-buddy-quick-actions-position",
      JSON.stringify({ edge: "right", verticalFraction: 4.7 })
    );
    expect(loadQuickActionsPosition()).toEqual({ edge: "right", verticalFraction: 1 });

    window.localStorage.setItem(
      "mad-buddy-quick-actions-position",
      JSON.stringify({ edge: "right", verticalFraction: -3 })
    );
    expect(loadQuickActionsPosition()).toEqual({ edge: "right", verticalFraction: 0 });
  });

  it("ignores a corrupt or foreign edge value rather than trusting it", () => {
    window.localStorage.setItem(
      "mad-buddy-quick-actions-position",
      JSON.stringify({ edge: "middle", verticalFraction: 0.5 })
    );
    expect(loadQuickActionsPosition()).toBeNull();
  });

  it("ignores unparsable JSON", () => {
    window.localStorage.setItem("mad-buddy-quick-actions-position", "{not json");
    expect(loadQuickActionsPosition()).toBeNull();
  });

  it("never throws when storage is unavailable", () => {
    const fakeWindow = (globalThis as unknown as { window: { localStorage: { setItem: () => void } } }).window;
    fakeWindow.localStorage.setItem = () => {
      throw new DOMException("blocked");
    };
    expect(() => saveQuickActionsPosition({ edge: "left", verticalFraction: 0.2 })).not.toThrow();
  });
});
