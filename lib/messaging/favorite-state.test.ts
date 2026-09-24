import { describe, expect, it } from "vitest";
import { isChatFavorite } from "@/lib/messaging/favorite-state";

describe("favorite flags shared by the inbox and shortcut bar", () => {
  it("recognizes a group favorited only through preferences", () => {
    expect(isChatFavorite(false, 0)).toBe(true);
  });

  it("removes a favorite only when both stored flags are cleared", () => {
    expect(isChatFavorite(true, null)).toBe(true);
    expect(isChatFavorite(false, 0)).toBe(true);
    expect(isChatFavorite(false, null)).toBe(false);
  });
});
