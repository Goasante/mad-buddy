import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { loadFriendGlowColors } from "@/lib/glow/custom-colors-server";

function adminWithRows(rows: Array<{ friend_id: string; color_id: string }>) {
  const eq = vi.fn().mockResolvedValue({ data: rows, error: null });
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));
  return { admin: { from }, from };
}

describe("custom glow is free core", () => {
  it("loads saved colours without consulting a subscription entitlement", async () => {
    const { admin, from } = adminWithRows([{ friend_id: "friend-1", color_id: "amber" }]);
    await expect(loadFriendGlowColors(admin as never, "owner-1")).resolves.toEqual({ "friend-1": "amber" });
    expect(from).toHaveBeenCalledWith("friend_glow_colors");
  });
});
