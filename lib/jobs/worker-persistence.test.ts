import { beforeEach, describe, expect, it, vi } from "vitest";
import type { createSupabaseAdminClient } from "@/lib/supabase/admin";

const state = vi.hoisted(() => ({ handler: vi.fn(), log: vi.fn() }));
vi.mock("@/lib/jobs/handlers", () => ({ JOB_HANDLERS: { "test.work": state.handler }, JobError: class extends Error {} }));
vi.mock("@/lib/communications/broadcast", () => ({ BROADCAST_JOB_TYPE: "broadcast", handleBroadcastEmailJob: vi.fn() }));
vi.mock("@/lib/observability/logger", () => ({ errorType: () => "database_error", logBackendEvent: state.log }));
import { enqueueDueSchedules, runTick } from "./worker";

type Admin = ReturnType<typeof createSupabaseAdminClient>;
function fixture(options: { enqueueError?: unknown; claimError?: unknown; updateError?: unknown } = {}) {
  const updates: unknown[] = [];
  const admin = {
    rpc: vi.fn().mockResolvedValue({ data: [{ id: "job", job_type: "test.work", attempts: 1, max_attempts: 3 }], error: options.claimError }),
    from: () => ({
      upsert: () => ({ select: () => ({ maybeSingle: async () => ({ data: null, error: options.enqueueError }) }) }),
      update: (value: unknown) => { updates.push(value); return { eq: async () => ({ error: options.updateError }) }; }
    })
  };
  return { admin: admin as unknown as Admin, updates, rpc: admin.rpc };
}

beforeEach(() => { vi.clearAllMocks(); state.handler.mockResolvedValue(1); });
describe("worker persistence failures", () => {
  it("does not turn a failed enqueue into an idle success", async () => {
    const error = { code: "08006" };
    const f = fixture({ enqueueError: error });
    await expect(enqueueDueSchedules(f.admin, 0)).rejects.toEqual(error);
  });
  it("propagates a claim failure", async () => {
    const error = { code: "08006" };
    const f = fixture({ claimError: error });
    await expect(runTick(f.admin, "worker")).rejects.toEqual(error);
    expect(state.handler).not.toHaveBeenCalled();
  });
  it("leaves a failed completion acknowledgement leased, not immediately retrying the successful side effect", async () => {
    const error = { code: "08006" };
    const f = fixture({ updateError: error });
    await expect(runTick(f.admin, "worker")).rejects.toEqual(error);
    expect(f.updates).toHaveLength(1);
    expect(f.updates[0]).toMatchObject({ status: "completed" });
    expect(state.log).not.toHaveBeenCalledWith("info", expect.objectContaining({ statusCode: 200 }));
  });
  it("does not claim a retry was persisted when failure acknowledgement fails", async () => {
    state.handler.mockRejectedValue(new Error("handler failed"));
    const error = { code: "08006" };
    const f = fixture({ updateError: error });
    await expect(runTick(f.admin, "worker")).rejects.toEqual(error);
    expect(f.updates).toHaveLength(1);
    expect(f.updates[0]).toMatchObject({ status: "retrying" });
  });
  it("preserves normal success counts", async () => {
    const f = fixture();
    await expect(runTick(f.admin, "worker")).resolves.toMatchObject({ processed: 1, succeeded: 1, failed: 0 });
  });
});
