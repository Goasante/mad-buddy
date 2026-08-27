import { describe, expect, it } from "vitest";

import { cameFromInsideApp } from "@/lib/navigation/entry-origin";

/**
 * What a Back control is allowed to assume about how it was reached.
 *
 * Behaviour, not source text: real inputs in, a real decision out. The rule
 * decides between `router.back()` and a fallback destination, and getting it
 * wrong in either direction is user-visible -- a cold entry that calls back()
 * leaves the product, and an in-app entry that pushes a fallback drops the
 * person somewhere they have never been.
 */

const win = (historyLength: number, origin = "https://mad-buddy.com") =>
  ({ history: { length: historyLength }, location: { origin } }) as unknown as Window;

describe("a page reached from inside the app", () => {
  it("recognises a real history stack", () => {
    expect(cameFromInsideApp(win(3), "")).toBe(true);
  });

  it("recognises a same-origin referrer even with a short stack", () => {
    // A replace() navigation can leave length at 1 while still being in-app.
    expect(cameFromInsideApp(win(1), "https://mad-buddy.com/dashboard")).toBe(true);
  });
});

describe("a cold entry", () => {
  it("a fresh tab with no referrer has nothing to go back to", () => {
    expect(cameFromInsideApp(win(1), "")).toBe(false);
  });

  it("an external referrer does not count as in-app", () => {
    // Arriving from a shared link: back() would return to the other site.
    expect(cameFromInsideApp(win(1), "https://example.com/somewhere")).toBe(false);
  });

  it("a look-alike origin does not count as in-app", () => {
    expect(cameFromInsideApp(win(1), "https://mad-buddy.com.evil.test/x")).toBe(false);
  });

  it("falls back safely when there is no window at all", () => {
    // Server render: assume the fallback rather than guessing.
    expect(cameFromInsideApp(undefined, "")).toBe(false);
  });
});
