import { beforeEach, describe, expect, it, vi } from "vitest";
import { seed } from "./seed";
const m = vi.hoisted(() => ({
  isAdmin: vi.fn(() => false),
  configuration: vi.fn(),
  allow: vi.fn(async () => true),
  store: vi.fn(),
  confirm: vi.fn(),
  checkPaymentSetup: vi.fn(),
}));
vi.mock("@/lib/shop/setup", () => ({ checkPaymentSetup: m.checkPaymentSetup }));
vi.mock("@/lib/shop/store", () => ({
  configuration: m.configuration,
  shopStore: m.store,
  audit: vi.fn(),
  records: vi.fn(),
}));
vi.mock("@/lib/shop/rate", () => ({ allow: m.allow }));
vi.mock("@/lib/shop/auth", async () => ({
  ...(await vi.importActual<object>("@/lib/shop/auth")),
  isAdmin: m.isAdmin,
}));
vi.mock("@/lib/shop/payments", async () => ({
  ...(await vi.importActual<object>("@/lib/shop/payments")),
  confirm: m.confirm,
}));
import { POST as shop } from "@/app/api/shop/[action]/route";
import { POST as admin, GET as adminGet } from "@/app/api/admin/[action]/route";
const ctx = (action: string) => ({ params: Promise.resolve({ action }) });
const req = (body: unknown, origin = "https://books.example.com") =>
  new Request("https://books.example.com/api/test", {
    method: "POST",
    headers: { origin, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
beforeEach(() => {
  vi.clearAllMocks();
  m.configuration.mockResolvedValue({ config: seed, etag: "seed" });
  m.isAdmin.mockReturnValue(false);
  process.env.NEXT_PUBLIC_APP_URL = "https://books.example.com";
  process.env.BOOK_DOWNLOAD_SECRET =
    "synthetic-signing-secret-with-thirty-two-characters";
});
describe("HTTP authorization and access", () => {
  it("never calls payment or email providers for an unauthenticated setup check", async () => {
    expect((await admin(req({}), ctx("payment-check"))).status).toBe(401);
    expect(m.checkPaymentSetup).not.toHaveBeenCalled();
  });
  it("rejects cross-site owner setup checks", async () => {
    m.isAdmin.mockReturnValue(true);
    expect((await admin(req({}, "https://evil.example"), ctx("payment-check"))).status).toBe(403);
    expect(m.checkPaymentSetup).not.toHaveBeenCalled();
  });
  it("does not expose admin reports to visitors", async () =>
    expect((await adminGet(req({}), ctx("reports"))).status).toBe(401));
  it("requires admin auth before accepting uploads", async () => {
    expect((await admin(req({}), ctx("upload"))).status).toBe(401);
    expect(m.store).not.toHaveBeenCalled();
  });
  it("rejects cross-site admin mutations", async () =>
    expect(
      (await admin(req({}, "https://evil.example"), ctx("config"))).status
    ).toBe(403));
  it("rejects cross-site downloads", async () =>
    expect(
      (
        await shop(
          req({ bookId: "acquisition-v1" }, "https://evil.example"),
          ctx("download")
        )
      ).status
    ).toBe(403));
  it("requires payment for paid books", async () => {
    m.configuration.mockResolvedValue({
      config: { ...seed, books: [{ ...seed.books[0], mode: "paid" }] },
      etag: "seed",
    });
    expect(
      (await shop(req({ bookId: "acquisition-v1" }), ctx("download"))).status
    ).toBe(403);
    expect(m.store).not.toHaveBeenCalled();
  });
  it("cannot download with a tampered token", async () => {
    expect(
      (await shop(req({ token: "fake.token" }), ctx("download"))).status
    ).toBe(403);
    expect(m.confirm).not.toHaveBeenCalled();
  });
  it("keeps contributions closed until activated", async () =>
    expect(
      (
        await shop(
          req({
            email: "buyer@example.com",
            kind: "support",
            bookId: "acquisition-v1",
            usd: 5,
            rate: 12,
          }),
          ctx("checkout")
        )
      ).status
    ).toBe(503));
});
