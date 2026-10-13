import "server-only";
import { randomUUID } from "node:crypto";
import { paystackRequest } from "@/lib/paystack/client";
import { getPaystackSecretKey } from "@/lib/paystack/config";
import { sendMadBuddyEmail } from "@/lib/email/send";

export type PaymentSetup = {
  ready: boolean;
  serverEnabled: boolean;
  signingReady: boolean;
  paystack: { ok: boolean; mode: "live" | "test" | null };
  receipt: { ok: boolean; skipped?: boolean; error?: string };
};

export async function checkPaymentSetup(email: string): Promise<PaymentSetup> {
  const key = getPaystackSecretKey();
  const mode = key?.startsWith("sk_live_") ? "live" :
    key?.startsWith("sk_test_") ? "test" : null;
  const result: PaymentSetup = {
    ready: false,
    serverEnabled: process.env.BOOK_SALES_ENABLED === "true",
    signingReady: (process.env.BOOK_DOWNLOAD_SECRET?.trim().length ?? 0) >= 32,
    paystack: { ok: false, mode },
    receipt: { ok: false, skipped: true },
  };
  if (!mode) return result;
  try {
    // An authenticated directory read validates the key without creating a charge.
    await paystackRequest("/bank?country=ghana&perPage=1", {
      cache: "no-store", signal: AbortSignal.timeout(10000),
    });
    result.paystack.ok = true;
  } catch {
    return result;
  }
  const receipt = await sendMadBuddyEmail({
    to: email,
    subject: "Your GOA bookshop payment setup check",
    text: "The GOA bookshop successfully connected to Paystack. This email checks the receipt delivery connection. No payment was made and no money was charged.\n\nGodfred Ofosu Asante",
    idempotencyKey: "gbs-setup-" + randomUUID(),
  });
  result.receipt = receipt.ok ? { ok: true } : { ok: false, error: receipt.errorCode };
  result.ready = result.serverEnabled && result.signingReady &&
    result.paystack.ok && mode === "live" && result.receipt.ok;
  return result;
}
