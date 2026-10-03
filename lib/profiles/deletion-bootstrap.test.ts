import { beforeEach, describe, expect, it, vi } from "vitest";
import type { User } from "@supabase/supabase-js";

const state = vi.hoisted(() => ({ existing: null as unknown, pending: null as unknown, readError: null as unknown, upsert: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: () => ({
  from: (table: string) => ({
    select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: table === "profiles" ? state.existing : state.pending, error: state.readError }) }) }),
    upsert: state.upsert
  })
}) }));
import { ensureProfileForUser } from "./ensure-profile";
const user = { id: "person", email: "person@example.test", user_metadata: {} } as User;

beforeEach(() => { vi.clearAllMocks(); state.existing = null; state.pending = null; state.readError = null;
  state.upsert.mockReturnValue({ select: () => ({ single: async () => ({ data: { user_id: "person" }, error: null }) }) }); });
describe("profile bootstrap during deletion", () => {
  it("does not resurrect an erased profile", async () => {
    state.pending = { stage: "audited" };
    await expect(ensureProfileForUser(user)).rejects.toThrow("Account deletion is in progress");
    expect(state.upsert).not.toHaveBeenCalled();
  });
  it("fails closed if deletion intent cannot be checked", async () => {
    state.readError = { code: "08006" };
    await expect(ensureProfileForUser(user)).rejects.toEqual(state.readError);
    expect(state.upsert).not.toHaveBeenCalled();
  });
  it("preserves ordinary bootstrap", async () => {
    await expect(ensureProfileForUser(user)).resolves.toEqual({ user_id: "person" });
    expect(state.upsert).toHaveBeenCalledOnce();
  });
  it("does not add a deletion lookup to the existing-profile fast path", async () => {
    state.existing = { user_id: "person" };
    await expect(ensureProfileForUser(user)).resolves.toEqual(state.existing);
    expect(state.upsert).not.toHaveBeenCalled();
  });
});
