import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ handle: vi.fn(), rate: vi.fn(async () => ({ allowed: true })) }));
vi.mock("@/lib/books/service", () => ({ handleBookWebhook: mocks.handle }));
vi.mock("@/lib/security/rate-limit", () => ({ consumeRateLimit: mocks.rate, getClientIpHashFromRequest: () => "synthetic-ip" }));
import { POST } from "@/app/api/paystack/webhook/route";
const key = "synthetic-secret-for-provider-signature-tests";
const body = JSON.stringify({ event: "charge.success", data: { reference: "synthetic-reference" } });
function request(payload = body, signature: string | null = createHmac("sha512", key).update(payload).digest("hex")) {
  return new Request("https://books.mad-buddy.com/api/paystack/webhook", {
    method: "POST", headers: { "Content-Type": "application/json", ...(signature ? { "x-paystack-signature": signature } : {}) }, body: payload
  });
}
beforeEach(() => { vi.clearAllMocks(); vi.unstubAllGlobals(); process.env.PAYSTACK_SECRET_KEY = key; delete process.env.PAYSTACK_WEBHOOK_SECRET; mocks.handle.mockResolvedValue(true); mocks.rate.mockResolvedValue({ allowed: true }); });
describe("standalone bookshop provider events", () => {
  it("rejects unsigned events before any database access or forwarding", async () => {
    const forward = vi.fn(); vi.stubGlobal("fetch", forward);
    expect((await POST(request(body, null))).status).toBe(400);
    expect(mocks.rate).not.toHaveBeenCalled(); expect(mocks.handle).not.toHaveBeenCalled(); expect(forward).not.toHaveBeenCalled();
  });
  it("does not route verified book events to the app", async () => {
    const forward = vi.fn(); vi.stubGlobal("fetch", forward);
    expect((await POST(request())).status).toBe(200); expect(mocks.handle).toHaveBeenCalledOnce(); expect(forward).not.toHaveBeenCalled();
  });
  it("forwards non-book events with their unchanged body and provider signature", async () => {
    mocks.handle.mockResolvedValue(false); const forward = vi.fn(async () => new Response("ok")); vi.stubGlobal("fetch", forward);
    expect((await POST(request())).status).toBe(200);
    expect(forward).toHaveBeenCalledWith("https://mad-buddy.com/api/paystack/webhook", expect.objectContaining({ body, redirect: "error", headers: expect.objectContaining({ "x-paystack-signature": createHmac("sha512", key).update(body).digest("hex") }) }));
  });
  it("asks Paystack to retry if app event forwarding fails", async () => {
    mocks.handle.mockResolvedValue(false); vi.stubGlobal("fetch", vi.fn(async () => new Response("unavailable", { status: 503 })));
    expect((await POST(request())).status).toBe(503);
  });
  it("asks Paystack to retry if book fulfilment fails", async () => {
    mocks.handle.mockRejectedValue(new Error("Mail unavailable")); expect((await POST(request())).status).toBe(503);
  });
  it("rejects oversized or malformed events", async () => {
    expect((await POST(request("x".repeat(256 * 1024 + 1)))).status).toBe(413);
    expect((await POST(request(JSON.stringify({ event: "charge.success", data: [] })))).status).toBe(400);
  });
});
