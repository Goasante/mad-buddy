import { describe, expect, it, vi } from "vitest";
import { createConfirmedAccount } from "@/lib/auth/bootstrap";
import type { createSupabaseAdminClient } from "@/lib/supabase/admin";

vi.mock("@/lib/observability/logger", () => ({ createRequestId: () => "test", logBackendEvent: vi.fn() }));

const input = { email: "  Member@Example.com  ", password: "test-only-password", fullName: "Test Member", username: "test_member", requestId: "test", startedAt: Date.now() };

describe("account creation integrity", () => {
  it.each(["email_exists", "user_already_exists"])("rejects %s without touching profile, billing or consent", async (code) => {
    const createUser = vi.fn().mockResolvedValue({ data: null, error: { code, message: "Duplicate" } });
    const from = vi.fn();
    const admin = { auth: { admin: { createUser } }, from } as unknown as ReturnType<typeof createSupabaseAdminClient>;
    const result = await createConfirmedAccount(admin, input);
    expect(result).toMatchObject({ ok: false, failure: { reason: "duplicate" } });
    expect(createUser).toHaveBeenCalledWith(expect.objectContaining({ email: "member@example.com" }));
    expect(from).not.toHaveBeenCalled();
  });

  it("bootstraps a genuinely new user once using the returned identity", async () => {
    const createUser = vi.fn().mockResolvedValue({ data: { user: { id: "new-id" } }, error: null });
    const upsert = vi.fn().mockResolvedValue({ error: null });
    const admin = { auth: { admin: { createUser } }, from: vi.fn(() => ({ upsert })) } as unknown as ReturnType<typeof createSupabaseAdminClient>;
    expect(await createConfirmedAccount(admin, input)).toEqual({ ok: true, account: { userId: "new-id", email: "member@example.com" } });
    expect(upsert).toHaveBeenCalledTimes(3);
    for (const [record] of upsert.mock.calls) expect(record.user_id).toBe("new-id");
  });
});
