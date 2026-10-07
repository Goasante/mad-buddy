import { beforeEach, describe, expect, it, vi } from "vitest";
import { processMeetupNotifications } from "./notifications";

const deliver = vi.hoisted(() => vi.fn());
const enabled = vi.hoisted(() => vi.fn());

vi.mock("@/lib/notifications/server", () => ({ deliverNotification: deliver }));
vi.mock("@/lib/features/availability-server", () => ({ optionalFeatureEnabled: enabled }));

const id = "10000000-0000-4000-8000-000000000001";
const row = {
  id,
  meetup_id: id,
  lease_id: id,
  recipient_id: id,
  sender_id: id,
  event: "invited",
  dedupe_key: "meetup:test"
};

const rpc = vi.fn();
const from = vi.fn(() => {
  const chain = {
    select: vi.fn(() => chain),
    in: vi.fn(async () => ({
      data: [{ user_id: id, full_name: "Dennis", username: "dennis" }],
      error: null
    }))
  };
  return chain;
});
const admin = () => ({ rpc, from } as never);

beforeEach(() => {
  enabled.mockReset().mockResolvedValue(true);
  deliver.mockReset().mockResolvedValue({ inApp: true });
  rpc.mockReset().mockImplementation(async (name: string) => ({
    data: name === "claim_meetup_notifications" ? [row] : true,
    error: null
  }));
  from.mockClear();
});

describe("durable meetup notifications", () => {
  it("does not query new tables when the feature is locked", async () => {
    enabled.mockResolvedValue(false);
    expect(await processMeetupNotifications({ rpc } as never)).toBe(0);
    expect(rpc).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
  });

  it("does not count preference-suppressed work as delivery", async () => {
    deliver.mockResolvedValue({ inApp: false, push: false, reason: "category_off" });
    expect(await processMeetupNotifications(admin())).toBe(0);
  });

  it("uses a Muddy name, privacy-safe copy and an idempotent delivery key", async () => {
    expect(await processMeetupNotifications(admin())).toBe(1);
    expect(deliver).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        type: `meetup:${id}`,
        category: "plans",
        dedupeKey: row.dedupe_key,
        message: expect.stringContaining("Dennis")
      })
    );
    expect(rpc).toHaveBeenCalledWith("finish_meetup_notification", {
      p_id: id,
      p_lease_id: id,
      p_sent: true
    });
  });

  it("rechecks authorization after claiming before delivering", async () => {
    rpc.mockImplementation(async (name: string) => ({
      data: name === "claim_meetup_notifications" ? [row] : name !== "meetup_notification_allowed",
      error: null
    }));
    expect(await processMeetupNotifications(admin())).toBe(0);
    expect(deliver).not.toHaveBeenCalled();
  });

  it("leaves transient failures for a durable retry", async () => {
    deliver.mockRejectedValue(new Error("network"));
    expect(await processMeetupNotifications(admin())).toBe(0);
    expect(rpc).toHaveBeenCalledWith("finish_meetup_notification", {
      p_id: id,
      p_lease_id: id,
      p_sent: false
    });
  });
});
