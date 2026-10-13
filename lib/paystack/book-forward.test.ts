import { afterEach, describe, expect, it, vi } from "vitest";
import { forwardBookWebhook } from "./book-forward";
import { MA_BOOK } from "@/lib/books/product";

afterEach(() => vi.unstubAllGlobals());
describe("book webhook cutover", () => {
  it("leaves app events in the existing app handler", async () => {
    const send = vi.fn(); vi.stubGlobal("fetch", send);
    for (const metadata of [undefined, {}, { product: "mad_buddy_access" }, "invalid", []]) {
      expect(await forwardBookWebhook("payload", "signature", metadata)).toBeNull();
    }
    expect(send).not.toHaveBeenCalled();
  });
  it("preserves the signed bytes and forwards only to the fixed bookshop", async () => {
    const send = vi.fn(async () => new Response("ok")); vi.stubGlobal("fetch", send);
    const body = '{ "event": "charge.success", "data": {} }';
    const result = await forwardBookWebhook(body, "synthetic-signature", { product: MA_BOOK.id });
    expect(result?.status).toBe(200);
    expect(send).toHaveBeenCalledWith("https://books.mad-buddy.com/api/paystack/webhook", expect.objectContaining({
      body, method: "POST", redirect: "error", headers: expect.objectContaining({ "x-paystack-signature": "synthetic-signature" })
    }));
  });
  it("recognizes Paystack's JSON-string metadata", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("ok")));
    expect((await forwardBookWebhook("payload", "signature", JSON.stringify({ product: MA_BOOK.id })))?.status).toBe(200);
  });
  it("does not acknowledge a book event when the destination fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("unavailable", { status: 503 })));
    expect((await forwardBookWebhook("payload", "signature", { product: MA_BOOK.id }))?.status).toBe(503);
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("timeout"); }));
    expect((await forwardBookWebhook("payload", "signature", { product: MA_BOOK.id }))?.status).toBe(503);
  });
});
