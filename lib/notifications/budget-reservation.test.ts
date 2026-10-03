import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { createSupabaseAdminClient } from "@/lib/supabase/admin";
const state = vi.hoisted(() => ({ after: vi.fn() }));
vi.mock("next/server", () => ({ after: state.after }));
import { deliverNotification } from "./server";

type Admin = ReturnType<typeof createSupabaseAdminClient>;
function fixture(options: { reserve?: boolean; error?: unknown; duplicate?: boolean } = {}) {
  const rpc = vi.fn().mockResolvedValue({ data: options.reserve ?? true, error: options.error });
  const insert = vi.fn().mockResolvedValue({ error: options.duplicate ? { code: "23505" } : null });
  const admin = { rpc, from: (table: string) => ({
    select: () => {
      const chain = { eq: () => chain, maybeSingle: async () => ({ data: table === "notification_budget_usage" ? { sent_count: 0 } : null, error: null }) };
      return chain;
    }, insert
  }) };
  return { admin: admin as unknown as Admin, rpc, insert };
}
const input = { userId: "person", type: "system_alert" as const, title: "Test", message: "Test", dedupeKey: "test:event" };
beforeEach(() => { vi.clearAllMocks(); vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-03T12:00:00Z")); });
afterEach(() => vi.useRealTimers());
describe("atomic notification budget", () => {
  it("reserves once before scheduling normal push", async () => {
    const f = fixture();
    const result = await deliverNotification(f.admin, input);
    expect(result.push).toBe(true);
    expect(f.rpc).toHaveBeenCalledWith("reserve_notification_budget", { p_user_id: "person", p_day_key: "2026-10-03", p_budget: 8 });
    expect(state.after).toHaveBeenCalledOnce();
  });
  it("keeps in-app delivery when a concurrent sender has taken the last slot", async () => {
    const f = fixture({ reserve: false });
    await expect(deliverNotification(f.admin, input)).resolves.toEqual({ inApp: true, push: false, reason: "budget_exhausted" });
    expect(state.after).not.toHaveBeenCalled();
  });
  it("fails closed for ordinary push if budget storage is unavailable", async () => {
    const f = fixture({ error: { code: "08006" } });
    await expect(deliverNotification(f.admin, input)).resolves.toEqual({ inApp: true, push: false, reason: "budget_unavailable" });
    expect(state.after).not.toHaveBeenCalled();
  });
  it.each(["high", "critical"] as const)("does not reserve or block %s priority alerts", async (priority) => {
    const f = fixture({ error: { code: "08006" } });
    expect((await deliverNotification(f.admin, { ...input, priority })).push).toBe(true);
    expect(f.rpc).not.toHaveBeenCalled();
  });
  it("does not consume another slot or send again for a deduplicated notification", async () => {
    const f = fixture({ duplicate: true });
    await expect(deliverNotification(f.admin, input)).resolves.toEqual({ inApp: true, push: false, reason: "duplicate" });
    expect(f.rpc).not.toHaveBeenCalled();
    expect(state.after).not.toHaveBeenCalled();
  });
});
