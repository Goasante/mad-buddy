import { beforeEach, describe, expect, it, vi } from "vitest";

const { resolveUserEntitlementsMock } = vi.hoisted(() => ({
  resolveUserEntitlementsMock: vi.fn()
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/billing/service", () => ({
  resolveUserEntitlements: resolveUserEntitlementsMock
}));

import { loadFriendGlowColors } from "@/lib/glow/custom-colors-server";

function adminWithRows(rows: Array<{ friend_id: string; color_id: string }>) {
  const eq = vi.fn().mockResolvedValue({ data: rows, error: null });
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));
  return { admin: { from }, from };
}

describe("server custom glow entitlement gate", () => {
  beforeEach(() => {
    resolveUserEntitlementsMock.mockReset();
  });

  it("does not read or return saved colours after downgrade", async () => {
    resolveUserEntitlementsMock.mockResolvedValue({ custom_glow_styles: false });
    const { admin, from } = adminWithRows([{ friend_id: "friend-1", color_id: "violet" }]);

    await expect(loadFriendGlowColors(admin as never, "owner-1")).resolves.toEqual({});
    expect(from).not.toHaveBeenCalled();
  });

  it("returns saved colours while the effective entitlement is active", async () => {
    resolveUserEntitlementsMock.mockResolvedValue({ custom_glow_styles: true });
    const { admin, from } = adminWithRows([
      { friend_id: "friend-1", color_id: "violet" },
      { friend_id: "friend-2", color_id: "amber" }
    ]);

    await expect(loadFriendGlowColors(admin as never, "owner-1")).resolves.toEqual({
      "friend-1": "violet",
      "friend-2": "amber"
    });
    expect(from).toHaveBeenCalledWith("friend_glow_colors");
  });
});
