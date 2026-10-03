import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { createSupabaseAdminClient } from "@/lib/supabase/admin";
const state = vi.hoisted(() => ({ sendWeb: vi.fn(), sendNative: vi.fn(), vapid: vi.fn() }));
vi.mock("web-push", () => ({ default: { setVapidDetails: vi.fn(), sendNotification: state.sendWeb } }));
vi.mock("./vapid", () => ({ readVapidConfiguration: state.vapid }));
vi.mock("firebase-admin/app", () => ({ getApps: () => [{ name: "madbuddy-fcm" }], cert: vi.fn(), initializeApp: vi.fn() }));
vi.mock("firebase-admin/messaging", () => ({ getMessaging: () => ({ send: state.sendNative }) }));
import { sendWebPushTarget } from "./push";
import { sendNativePushTarget } from "./fcm";

function fixture(options: { missing?: boolean; pruneError?: boolean } = {}) {
  const filters = vi.fn(); const remove = vi.fn();
  const from = (table: string) => {
    const query = { select: () => query, eq: (column: string, value: string) => { filters(table, column, value); return query; },
      maybeSingle: async () => ({ data: options.missing ? null : table === "push_subscriptions"
        ? { id: "target", endpoint: "https://push.invalid/test", p256dh: "synthetic-key", auth: "synthetic-auth" }
        : { token: "synthetic-token" }, error: null }),
      delete: () => { remove(table); return query; },
      then: (resolve: (value: object) => void) => Promise.resolve({ error: options.pruneError ? { code: "08006" } : null }).then(resolve)
    };
    return query;
  };
  return { admin: { from } as unknown as ReturnType<typeof createSupabaseAdminClient>, filters, remove };
}
const safe = { title: "Mad Buddy", body: "Private update", url: "/notifications", tag: "dispatch" };
beforeEach(() => {
  vi.clearAllMocks(); state.sendWeb.mockResolvedValue({}); state.sendNative.mockResolvedValue("accepted");
  state.vapid.mockReturnValue({ ok: true, publicKey: "synthetic", privateKey: "synthetic", subject: "mailto:test@example.invalid" });
  vi.stubEnv("FIREBASE_SERVICE_ACCOUNT_BASE64", Buffer.from(JSON.stringify({ project_id: "synthetic", client_email: "test@example.invalid", private_key: "synthetic" })).toString("base64"));
});
afterEach(() => vi.unstubAllEnvs());
describe("per-device transports", () => {
  it("scopes the web target to its recipient and bounds the network request", async () => {
    const f = fixture(); await expect(sendWebPushTarget(f.admin, "user", "target", safe, 120)).resolves.toBe("delivered");
    expect(f.filters).toHaveBeenCalledWith("push_subscriptions", "user_id", "user");
    expect(state.sendWeb).toHaveBeenCalledWith(expect.anything(), JSON.stringify(safe), { TTL: 120, timeout: 10000 });
  });
  it("prunes only the stale subscription snapshot after 410", async () => {
    state.sendWeb.mockRejectedValueOnce({ statusCode: 410 }); const f = fixture();
    await expect(sendWebPushTarget(f.admin, "user", "target", safe, 120)).resolves.toBe("gone");
    expect(f.filters).toHaveBeenCalledWith("push_subscriptions", "endpoint", "https://push.invalid/test");
    expect(f.filters).toHaveBeenCalledWith("push_subscriptions", "auth", "synthetic-auth");
    expect(f.remove).toHaveBeenCalledOnce();
  });
  it("does not discard a valid subscription for temporary provider failure", async () => {
    state.sendWeb.mockRejectedValueOnce({ statusCode: 503 }); const f = fixture();
    await expect(sendWebPushTarget(f.admin, "user", "target", safe, 120)).rejects.toEqual({ statusCode: 503 });
    expect(f.remove).not.toHaveBeenCalled();
  });
  it("does not report stale cleanup success when the delete failed", async () => {
    state.sendWeb.mockRejectedValueOnce({ statusCode: 404 }); const f = fixture({ pruneError: true });
    await expect(sendWebPushTarget(f.admin, "user", "target", safe, 120)).rejects.toEqual({ code: "08006" });
  });
  it("treats a removed target as terminal without sending", async () => {
    const f = fixture({ missing: true }); expect(await sendWebPushTarget(f.admin, "user", "target", safe, 120)).toBe("gone");
    expect(state.sendWeb).not.toHaveBeenCalled();
  });
  it("uses one native token and a stable display identifier", async () => {
    const f = fixture(); await sendNativePushTarget(f.admin, "user", "target", safe, "dispatch", "2026-10-03T23:00:00Z");
    expect(state.sendNative).toHaveBeenCalledWith(expect.objectContaining({ token: "synthetic-token",
      android: expect.objectContaining({ notification: expect.objectContaining({ tag: "dispatch" }) }),
      apns: expect.objectContaining({ headers: expect.objectContaining({ "apns-collapse-id": "dispatch" }) }) }));
  });
  it("does not delete a native token for a malformed payload error", async () => {
    state.sendNative.mockRejectedValueOnce({ code: "messaging/invalid-argument" }); const f = fixture();
    await expect(sendNativePushTarget(f.admin, "user", "target", safe, "dispatch", "2026-10-03T23:00:00Z")).rejects.toEqual({ code: "messaging/invalid-argument" });
    expect(f.remove).not.toHaveBeenCalled();
  });
  it("protects a rotated native token when pruning the old snapshot", async () => {
    state.sendNative.mockRejectedValueOnce({ code: "messaging/registration-token-not-registered" }); const f = fixture();
    expect(await sendNativePushTarget(f.admin, "user", "target", safe, "dispatch", "2026-10-03T23:00:00Z")).toBe("gone");
    expect(f.filters).toHaveBeenCalledWith("device_push_tokens", "token", "synthetic-token");
  });
});
