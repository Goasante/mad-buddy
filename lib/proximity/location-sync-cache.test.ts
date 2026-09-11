import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("components/app-shell/location-signal-sync.tsx", "utf8");

describe("foreground location sync refreshes live proximity truth", () => {
  it("invalidates Home Nearby before announcing a successful location update", () => {
    const successBlock = source.slice(
      source.indexOf("if (response.ok)"),
      source.indexOf("const data =", source.indexOf("if (response.ok)"))
    );

    const invalidate = successBlock.indexOf("appCache.invalidate(cacheKeys.homeNearby())");
    const dispatch = successBlock.indexOf('window.dispatchEvent(new Event("mad-buddy:location-updated"))');

    expect(invalidate).toBeGreaterThanOrEqual(0);
    expect(dispatch).toBeGreaterThanOrEqual(0);
    expect(invalidate).toBeLessThan(dispatch);
  });

  it("invalidates only the proximity rail cache, not the whole app cache", () => {
    expect(source).toContain("appCache.invalidate(cacheKeys.homeNearby())");
    expect(source).not.toContain("appCache.invalidateAll()");
  });
});
