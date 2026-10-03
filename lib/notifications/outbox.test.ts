import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { createSupabaseAdminClient } from "@/lib/supabase/admin";
const transport = vi.hoisted(() => ({ web: vi.fn(), native: vi.fn() }));
vi.mock("./push", () => ({ sendWebPushTarget: transport.web }));
vi.mock("./fcm", () => ({ sendNativePushTarget: transport.native }));
import { classifyPushFailure, drainPushOutbox } from "./outbox";

const user = "a0000000-0000-4000-8000-000000000001";
const sender = "a0000000-0000-4000-8000-000000000002";
function claim(id: string, native = false) {
  return { id, dispatch_id: "dispatch", transport: native ? "native" : "web", target_id: `target-${id}`,
    attempts: 1, lease_id: `lease-${id}`, user_id: user, payload: { title: "Mad Buddy", body: "Private update", url: "/notifications" },
    context: { priority: "normal", category: "conference", senderId: sender }, expires_at: "2026-10-03T13:00:00Z" };
}
function fixture(rows: ReturnType<typeof claim>[], options: { blocked?: boolean; deleted?: boolean; muted?: boolean; prefsError?: boolean; ackError?: boolean; claimError?: boolean } = {}) {
  const pending = [...rows]; const reads = vi.fn();
  const rpc = vi.fn(async (name: string) => {
    if (name === "claim_notification_push") return { data: pending.splice(0, 4), error: options.claimError ? { code: "08006" } : null };
    return { data: true, error: options.ackError ? { code: "08006" } : null };
  });
  const from = (table: string) => {
    reads(table);
    const response = { data: table === "user_preferences" && options.muted ? { notification_preferences: { categories: { conference: "off" } } }
      : table === "blocked_users" ? (options.blocked ? [{ id: "block" }] : [])
      : table === "account_deletion_requests" && options.deleted ? { user_id: user } : null,
    error: table === "user_preferences" && options.prefsError ? { code: "08006" } : null };
    const query = { select: () => query, eq: () => query, or: () => query, limit: async () => response, maybeSingle: async () => response };
    return query;
  };
  return { admin: { rpc, from } as unknown as ReturnType<typeof createSupabaseAdminClient>, rpc, reads };
}
beforeEach(() => { vi.resetAllMocks(); vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-03T12:00:00Z"));
  transport.web.mockResolvedValue("delivered"); transport.native.mockResolvedValue("delivered"); });
afterEach(() => vi.useRealTimers());
describe("durable device delivery", () => {
  it("acknowledges device success independently from a transient device failure", async () => {
    const f = fixture([claim("good"), claim("bad")]);
    transport.web.mockResolvedValueOnce("delivered").mockRejectedValueOnce({ statusCode: 503 });
    await expect(drainPushOutbox(f.admin, "dispatch")).resolves.toEqual({ claimed: 2, handled: 2 });
    expect(f.rpc).toHaveBeenCalledWith("finish_notification_push", expect.objectContaining({ p_id: "good", p_outcome: "delivered" }));
    expect(f.rpc).toHaveBeenCalledWith("finish_notification_push", expect.objectContaining({ p_id: "bad", p_outcome: "retry" }));
    expect(transport.web).toHaveBeenCalledTimes(2);
    expect(f.reads.mock.calls.filter(([table]) => table === "user_preferences")).toHaveLength(1);
  });
  it("sends native and web using separate targets and stable dispatch identifiers", async () => {
    const f = fixture([claim("web"), claim("native", true)]); await drainPushOutbox(f.admin);
    expect(transport.web).toHaveBeenCalledWith(f.admin, user, "target-web", expect.objectContaining({ tag: "dispatch" }), 3600);
    expect(transport.native).toHaveBeenCalledWith(f.admin, user, "target-native", expect.objectContaining({ data: { url: "/notifications" } }), "dispatch", "2026-10-03T13:00:00Z");
  });
  it.each(["blocked", "deleted", "muted"] as const)("suppresses previously queued push after %s changes", async (key) => {
    const f = fixture([claim("target")], { [key]: true }); await drainPushOutbox(f.admin);
    expect(transport.web).not.toHaveBeenCalled();
    expect(f.rpc).toHaveBeenCalledWith("finish_notification_push", expect.objectContaining({ p_outcome: "suppressed" }));
  });
  it("retries a preference read error without sending or pretending it succeeded", async () => {
    const f = fixture([claim("target")], { prefsError: true }); await drainPushOutbox(f.admin);
    expect(transport.web).not.toHaveBeenCalled();
    expect(f.rpc).toHaveBeenCalledWith("finish_notification_push", expect.objectContaining({ p_outcome: "retry" }));
  });
  it("does not classify a failed success acknowledgement as a transport retry", async () => {
    const f = fixture([claim("target")], { ackError: true });
    expect((await drainPushOutbox(f.admin)).handled).toBe(0);
    expect(f.rpc.mock.calls.filter(([name]) => name === "finish_notification_push")).toHaveLength(1);
    expect(f.rpc).toHaveBeenCalledWith("finish_notification_push", expect.objectContaining({ p_outcome: "delivered" }));
  });
  it("surfaces claim failure rather than reporting an empty successful queue", async () => {
    const f = fixture([], { claimError: true }); await expect(drainPushOutbox(f.admin)).rejects.toEqual({ code: "08006" });
  });
  it("stops claiming more devices when a batch consumes the time budget", async () => {
    const f = fixture(Array.from({ length: 8 }, (_, i) => claim(String(i))));
    transport.web.mockImplementationOnce(async () => { vi.advanceTimersByTime(30_000); return "delivered"; });
    expect((await drainPushOutbox(f.admin)).claimed).toBe(4);
    expect(f.rpc.mock.calls.filter(([name]) => name === "claim_notification_push")).toHaveLength(1);
  });
  it("never sends expired notifications", async () => {
    const row = claim("expired"); row.expires_at = "2026-10-03T11:00:00Z";
    const f = fixture([row]); await drainPushOutbox(f.admin); expect(transport.web).not.toHaveBeenCalled();
  });
  it.each([400, 413])("does not repeatedly retry malformed provider requests (%s)", (statusCode) => {
    expect(classifyPushFailure({ statusCode })).toBe("failed");
  });
  it.each([401, 403, 429, 500, 503])("allows repair/retry of provider failures (%s)", (statusCode) => {
    expect(classifyPushFailure({ statusCode })).toBe("retry");
  });
});
