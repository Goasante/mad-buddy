import { describe, expect, it } from "vitest";
import { resolveUpForActivityArtwork } from "@/lib/visuals/upfor-art";

describe("UpFor activity artwork", () => {
  it("maps only activities that existing photography honestly depicts", () => {
    expect(resolveUpForActivityArtwork("food")?.asset.path).toBe("/visuals/activities/dinner.jpg");
    expect(resolveUpForActivityArtwork("sports")?.asset.path).toBe("/visuals/activities/football.jpg");
    expect(resolveUpForActivityArtwork("walk")?.asset.path).toBe("/visuals/activities/beach.jpg");
    expect(resolveUpForActivityArtwork("chill")?.asset.path).toBe("/visuals/activities/beach.jpg");
    expect(resolveUpForActivityArtwork("coffee")?.asset.path).toBe("/visuals/activities/coffee.jpg");
    expect(resolveUpForActivityArtwork("football")?.asset.path).toBe("/visuals/activities/football.jpg");
    expect(resolveUpForActivityArtwork("movie")?.asset.path).toBe("/visuals/activities/movie.jpg");
    expect(resolveUpForActivityArtwork("party")?.asset.path).toBe("/visuals/activities/party.jpg");
  });

  it("never substitutes misleading photography for missing activity art", () => {
    for (const activity of ["study", "gym", "gaming", "drinks", "drive", "anything"] as const) {
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
