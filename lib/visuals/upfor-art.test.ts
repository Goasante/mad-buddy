import { describe, expect, it } from "vitest";
import { resolveUpForActivityArtwork } from "@/lib/visuals/upfor-art";

describe("UpFor activity artwork", () => {
  it("maps only activities that existing photography honestly depicts", () => {
    expect(resolveUpForActivityArtwork("food")?.asset.path).toBe("/visuals/upfor/dinner-natural-v2.jpg");
    expect(resolveUpForActivityArtwork("sports")?.asset.path).toBe("/visuals/upfor/football-natural-v2.jpg");
    // walk gained its own approved photograph on 2026-09-10 and no longer
    // borrows beach's as a placeholder.
    expect(resolveUpForActivityArtwork("walk")?.asset.path).toBe("/visuals/upfor/walk-natural-v2.jpg");
    expect(resolveUpForActivityArtwork("chill")?.asset.path).toBe("/visuals/upfor/beach-natural-v2.jpg");
    expect(resolveUpForActivityArtwork("coffee")?.asset.path).toBe("/visuals/upfor/coffee-natural-v2.jpg");
    expect(resolveUpForActivityArtwork("football")?.asset.path).toBe("/visuals/upfor/football-natural-v2.jpg");
    expect(resolveUpForActivityArtwork("movie")?.asset.path).toBe("/visuals/upfor/movie-natural-v2.jpg");
    expect(resolveUpForActivityArtwork("party")?.asset.path).toBe("/visuals/upfor/party-natural-v2.jpg");
    // study and gaming gained approved replacement photography on 2026-09-10.
    expect(resolveUpForActivityArtwork("study")?.asset.path).toBe("/visuals/upfor/study-natural-v2.jpg");
    expect(resolveUpForActivityArtwork("gaming")?.asset.path).toBe("/visuals/upfor/gaming-natural-v2.jpg");
  });

  it("never substitutes misleading photography for missing activity art", () => {
    for (const activity of ["gym", "drinks", "drive", "anything"] as const) {
      expect(resolveUpForActivityArtwork(activity), activity).toBeNull();
    }
  });

  it("provides one stable crop anchor to every image consumer", () => {
    expect(resolveUpForActivityArtwork("food")?.objectPosition).toBe("50% 50%");
    expect(resolveUpForActivityArtwork("sports")?.objectPosition).toBe("50% 50%");
  });

  it("degrades safely for absent or unknown values", () => {
    for (const value of [null, undefined, "", "work", "networking", "not-an-activity"]) {
      expect(() => resolveUpForActivityArtwork(value as never)).not.toThrow();
      expect(resolveUpForActivityArtwork(value as never)).toBeNull();
    }
  });
});
