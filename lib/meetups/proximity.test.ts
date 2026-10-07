import { describe, expect, it, vi } from "vitest";
import { refreshMeetupProximity, MEETUP_FIX_MAX_AGE_MS } from "./proximity";

describe("Meet Up coarse proximity refresh", () => {
  it("delegates the signed-in participant to the server-only Beacon projector", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: 2, error: null });
    const admin = { rpc } as never;
    await expect(refreshMeetupProximity(admin, "10000000-0000-4000-8000-000000000001")).resolves.toBe(2);
    expect(rpc).toHaveBeenCalledWith("refresh_meetup_proximity_server", {
      p_actor_id: "10000000-0000-4000-8000-000000000001"
    });
  });

  it("fails closed when the server projection cannot refresh", async () => {
    const error = new Error("read failed");
    const admin = { rpc: vi.fn().mockResolvedValue({ data: null, error }) } as never;
    await expect(refreshMeetupProximity(admin, "10000000-0000-4000-8000-000000000001")).rejects.toBe(error);
  });

  it("keeps the location freshness window short", () => {
    expect(MEETUP_FIX_MAX_AGE_MS).toBe(2 * 60_000);
  });
});
