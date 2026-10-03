import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { createSupabaseAdminClient } from "@/lib/supabase/admin";
const state = vi.hoisted(() => ({ after: vi.fn() }));
vi.mock("next/server", () => ({ after: state.after }));
import { deliverNotification } from "./server";

type Admin = ReturnType<typeof createSupabaseAdminClient>;
function fixture(options: { result?: object; error?: unknown; prefsError?: unknown } = {}) {
  const rpc = vi.fn().mockResolvedValue({ data: options.result ?? { dispatchId: "saved", inApp: true, push: true, reason: "queued" }, error: options.error });
  const insert = vi.fn().mockResolvedValue({ error: null });
  const admin = { rpc, from: (table: string) => ({ select: () => {
    const chain = { eq: () => chain, maybeSingle: async () => ({ data: table === "notification_budget_usage" ? { sent_count: 0 } : null,
      error: table === "user_preferences" ? options.prefsError : null }) }; return chain;
  }, insert }) };
  return { admin: admin as unknown as Admin, rpc, insert };
}
const input = { userId: "person", type: "system_alert" as const, title: "Test", message: "Test", dedupeKey: "test:event" };
beforeEach(() => { vi.clearAllMocks(); vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-03T12:00:00Z")); });
afterEach(() => vi.useRealTimers());
describe("transactional notification dispatch", () => {
  it("persists in-app, budget and outbox together before scheduling transport", async () => {
    const f = fixture();
    expect((await deliverNotification(f.admin, input)).push).toBe(true);
    expect(f.rpc).toHaveBeenCalledWith("enqueue_notification_dispatch", expect.objectContaining({
      p_user_id: "person", p_day_key: "2026-10-03", p_budget: 8, p_bypass_budget: false, p_persist: true
    }));
    expect(f.insert).not.toHaveBeenCalled();
    expect(state.after).toHaveBeenCalledOnce();
  });
  it("preserves in-app delivery when the last budget slot was taken", async () => {
    const result = { inApp: true, push: false, reason: "budget_exhausted" };
    const f = fixture({ result });
    await expect(deliverNotification(f.admin, input)).resolves.toEqual(result);
    expect(state.after).not.toHaveBeenCalled();
  });
  it("surfaces a failed transaction so the originating worker can retry", async () => {
    const error = { code: "08006" }; const f = fixture({ error });
    await expect(deliverNotification(f.admin, input)).rejects.toEqual(error);
    expect(state.after).not.toHaveBeenCalled();
  });
  it.each(["high", "critical"] as const)("retains %s budget bypass", async (priority) => {
    const f = fixture(); await deliverNotification(f.admin, { ...input, priority });
    expect(f.rpc).toHaveBeenCalledWith("enqueue_notification_dispatch", expect.objectContaining({ p_bypass_budget: true }));
  });
  it("does not schedule another push for a duplicate", async () => {
    const result = { inApp: true, push: false, reason: "duplicate" }; const f = fixture({ result });
    await expect(deliverNotification(f.admin, input)).resolves.toEqual(result);
    expect(state.after).not.toHaveBeenCalled();
  });
  it("keeps unread chat state canonical rather than adding a Pulse row", async () => {
    const f = fixture(); await deliverNotification(f.admin, { ...input, persistInApp: false });
    expect(f.rpc).toHaveBeenCalledWith("enqueue_notification_dispatch", expect.objectContaining({ p_persist: false }));
  });
  it("fails closed to in-app delivery when preferences cannot be read", async () => {
    const f = fixture({ prefsError: { code: "08006" } });
    expect((await deliverNotification(f.admin, input)).push).toBe(false);
    expect(f.insert).toHaveBeenCalledOnce(); expect(f.rpc).not.toHaveBeenCalled();
  });
  it("retains the saved queue if after() cannot schedule immediate work", async () => {
    state.after.mockImplementationOnce(() => { throw new Error("no request context"); });
    const f = fixture();
    await expect(deliverNotification(f.admin, input)).resolves.toMatchObject({ push: true, reason: "queued" });
    expect(f.rpc).toHaveBeenCalledOnce();
  });
});
