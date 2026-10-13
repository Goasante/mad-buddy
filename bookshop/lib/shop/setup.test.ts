import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ paystack: vi.fn(), email: vi.fn() }));
vi.mock("@/lib/paystack/client", () => ({ paystackRequest: mocks.paystack }));
vi.mock("@/lib/email/send", () => ({ sendMadBuddyEmail: mocks.email }));
import { checkPaymentSetup } from "./setup";

beforeEach(() => {
  vi.clearAllMocks();
  process.env.PAYSTACK_SECRET_KEY = "sk_live_synthetic";
  process.env.BOOK_SALES_ENABLED = "true";
  process.env.BOOK_DOWNLOAD_SECRET = "synthetic-signing-key-with-at-least-thirty-two-characters";
  mocks.paystack.mockResolvedValue([]);
  mocks.email.mockResolvedValue({ ok: true, providerMessageId: "test-email" });
});
describe("owner payment setup checks", () => {
  it("checks the directory without creating a financial transaction and sends only to the owner", async () => {
    const result = await checkPaymentSetup("owner@example.com");
    expect(result.ready).toBe(true);
    expect(mocks.paystack).toHaveBeenCalledOnce();
    expect(mocks.paystack.mock.calls[0][0]).toBe("/bank?country=ghana&perPage=1");
    expect(mocks.email.mock.calls[0][0]).toMatchObject({ to: "owner@example.com" });
  });
  it("does not send an email or report readiness when Paystack rejects the key", async () => {
    mocks.paystack.mockRejectedValue(new Error("Unauthorized"));
    expect((await checkPaymentSetup("owner@example.com")).ready).toBe(false);
    expect(mocks.email).not.toHaveBeenCalled();
  });
  it("does not call providers with a missing key", async () => {
    delete process.env.PAYSTACK_SECRET_KEY;
    expect((await checkPaymentSetup("owner@example.com")).ready).toBe(false);
    expect(mocks.paystack).not.toHaveBeenCalled();
  });
  it("keeps live activation unready with a test key", async () => {
    process.env.PAYSTACK_SECRET_KEY = "sk_test_synthetic";
    const result = await checkPaymentSetup("owner@example.com");
    expect(result.paystack).toEqual({ ok: true, mode: "test" });
    expect(result.ready).toBe(false);
  });
  it("keeps activation unready when receipt delivery fails", async () => {
    mocks.email.mockResolvedValue({ ok: false, errorCode: "validation_error" });
    const result = await checkPaymentSetup("owner@example.com");
    expect(result.ready).toBe(false);
    expect(result.receipt.error).toBe("validation_error");
  });
});
