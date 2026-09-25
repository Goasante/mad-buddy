import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  callbacks: [] as Array<() => Promise<void>>,
  notification: vi.fn().mockResolvedValue({ inApp: true }),
  milestone: vi.fn().mockResolvedValue(undefined),
  achievement: vi.fn().mockResolvedValue(undefined),
  lifeEvent: vi.fn().mockResolvedValue(undefined)
}));

vi.mock("next/server", () => ({ after: (callback: () => Promise<void>) => { mocks.callbacks.push(callback); } }));
vi.mock("@/lib/supabase/env", () => ({
  getSupabaseBrowserEnv: () => ({ url: "https://example.test", anonKey: "test" }),
  getSupabaseServerEnv: () => ({ url: "https://example.test", serviceRoleKey: "test" })
}));
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { full_name: "Test" } }) }) }) })
  })
}));
vi.mock("@/lib/notifications/server", () => ({ deliverNotification: mocks.notification }));
vi.mock("@/lib/onboarding/service", () => ({ recordMilestone: mocks.milestone }));
vi.mock("@/lib/engagement/achievements", () => ({ grantFriendshipAchievements: mocks.achievement }));
vi.mock("@/lib/life/emit", () => ({ emitLifeEvent: mocks.lifeEvent }));

import { acceptFriendRequest } from "./service";

describe("friend acceptance response", () => {
  beforeEach(() => {
    mocks.callbacks.length = 0;
    vi.clearAllMocks();
  });

  it("returns as soon as the friendship RPC commits, before optional effects", async () => {
    const client = {
      rpc: vi.fn().mockResolvedValue({
        data: [{ sender_id: "22222222-2222-4222-8222-222222222222", reactivated: false }],
        error: null
      })
    } as unknown as Parameters<typeof acceptFriendRequest>[0];

    const result = await acceptFriendRequest(client, "11111111-1111-4111-8111-111111111111", "33333333-3333-4333-8333-333333333333");
    expect(result).toMatchObject({ ok: true, message: "Muddy request accepted." });
    expect(mocks.callbacks).toHaveLength(1);
    expect(mocks.notification).not.toHaveBeenCalled();
    await mocks.callbacks[0]();
    expect(mocks.milestone).toHaveBeenCalledTimes(3);
    expect(mocks.achievement).toHaveBeenCalledTimes(2);
    expect(mocks.notification).toHaveBeenCalledTimes(1);
  });
});
