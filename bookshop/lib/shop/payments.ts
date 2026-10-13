import "server-only";
import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import {
  paystackRequest,
  type PaystackInitializeTransaction,
} from "@/lib/paystack/client";
import { sendMadBuddyEmail } from "@/lib/email/send";
import { configuration, shopStore } from "./store";
import { signToken } from "./auth";
import { type Order, type Book } from "./schema";
import { getPaystackSecretKey } from "@/lib/paystack/config";
export const PRODUCT = "godfred_bookshop_v2";
export function ready() {
  return (
    process.env.BOOK_SALES_ENABLED === "true" &&
    Boolean(getPaystackSecretKey()) &&
    Boolean(process.env.RESEND_API_KEY) &&
    Boolean(process.env.MAD_BUDDY_EMAIL_FROM)
  );
}
export function referenceValid(value: string) {
  return /^GBS-[a-f0-9-]{36}$/.test(value);
}
export function proofHash(proof: string) {
  return createHash("sha256").update(proof).digest("hex");
}
export function proofMatches(proof: string | undefined, expected: string) {
  return Boolean(
    proof &&
      /^[a-f0-9]{64}$/.test(expected) &&
      timingSafeEqual(
        Buffer.from(proofHash(proof!), "hex"),
        Buffer.from(expected, "hex")
      )
  );
}
export function convertedAmount(usd: number, rate: number) {
  return Math.round(usd * rate * 100);
}
export function accessToken(order: Order) {
  return signToken(
    { ref: order.reference, exp: Date.now() + 24 * 3600000 },
    "purchase"
  );
}
export function verified(payment: Record<string, unknown>, order: Order) {
  let meta = payment.metadata;
  try {
    if (typeof meta === "string") meta = JSON.parse(meta);
  } catch {
    return false;
  }
  const m = meta as Record<string, unknown> | null;
  const customer = payment.customer as { email?: string } | undefined;
  return (
    payment.status === "success" &&
    payment.reference === order.reference &&
    payment.amount === order.amountMinor &&
    payment.currency === order.currency &&
    payment.domain ===
      (getPaystackSecretKey()?.startsWith("sk_live_")
        ? "live"
        : "test") &&
    m?.product === PRODUCT &&
    m?.order_id === order.id &&
    customer?.email?.trim().toLowerCase() === order.email
  );
}
export async function getOrder(reference: string): Promise<Order | null> {
  if (!referenceValid(reference)) return null;
  return shopStore().get("orders/" + reference, { type: "json" });
}
export async function initialize(input: {
  email: string;
  kind: "support" | "purchase";
  book: Book;
  amountMinor: number;
}) {
  const reference = "GBS-" + randomUUID(),
    proof = randomBytes(32).toString("hex");
  const order: Order = {
    id: randomUUID(),
    reference,
    email: input.email.toLowerCase(),
    kind: input.kind,
    bookId: input.book.id,
    file: input.book.pdf,
    amountMinor: input.amountMinor,
    currency: "GHS",
    proofHash: proofHash(proof),
    createdAt: new Date().toISOString(),
    status: "pending",
  };
  await shopStore().setJSON("orders/" + reference, order, { onlyIfNew: true });
  const { config } = await configuration();
  await shopStore().setJSON(
    "order-terms/" + reference,
    {
      terms: config.settings.terms,
      rate: config.settings.ghsPerUsd,
      bookTitle: input.book.title,
    },
    { onlyIfNew: true }
  );
  const site = new URL(process.env.NEXT_PUBLIC_APP_URL!).origin;
  const result = await paystackRequest<PaystackInitializeTransaction>(
    "/transaction/initialize",
    {
      method: "POST",
      body: {
        email: order.email,
        amount: order.amountMinor,
        currency: "GHS",
        reference,
        callback_url: site + "/receipt",
        metadata: { product: PRODUCT, order_id: order.id, kind: order.kind },
      },
    }
  );
  const url = new URL(result.authorization_url);
  if (
    url.protocol !== "https:" ||
    url.hostname !== "checkout.paystack.com" ||
    result.reference !== reference
  )
    throw new Error("Unexpected checkout response.");
  return { order, proof, url: result.authorization_url };
}
export async function confirm(reference: string, receipt = true) {
  const store = shopStore();
  const old = await store.getWithMetadata("orders/" + reference, {
    type: "json",
  });
  const order = old?.data as Order | undefined;
  if (!order || order.status === "revoked") return null;
  const payment = await paystackRequest<Record<string, unknown>>(
    "/transaction/verify/" + encodeURIComponent(reference),
    { cache: "no-store" }
  );
  if (!verified(payment, order)) {
    if (
      order.status === "paid" &&
      ["reversed", "failed"].includes(String(payment.status))
    )
      await store.setJSON(
        "orders/" + reference,
        { ...order, status: "revoked" },
        { onlyIfMatch: old!.etag! }
      );
    return null;
  }
  const paid: Order = {
    ...order,
    status: "paid",
    paidAt: order.paidAt || new Date().toISOString(),
  };
  if (order.status !== "paid") {
    const saved = await store.setJSON("orders/" + reference, paid, {
      onlyIfMatch: old!.etag!,
    });
    if (!saved.modified) {
      const latest = await getOrder(reference);
      if (latest?.status !== "paid") return null;
    }
  }
  if (receipt && !(await store.get("receipts/" + reference))) {
    const url = new URL("/receipt", process.env.NEXT_PUBLIC_APP_URL!);
    url.searchParams.set("token", accessToken(paid));
    const sent = await sendMadBuddyEmail({
      to: paid.email,
      subject:
        paid.kind === "support"
          ? "Thank you for supporting the next book"
          : "Your book is ready",
      idempotencyKey: "gbs-" + paid.id,
      text: `${
        paid.kind === "support"
          ? "Thank you for your optional contribution."
          : "Thank you for your book purchase."
      }\nAmount: GHS ${(paid.amountMinor / 100).toFixed(2)}\nReference: ${
        paid.reference
      }\n\n${
        paid.kind === "purchase"
          ? "Access your personal copy (link expires in 24 hours): " +
            url.toString()
          : "Free books remain available at " + process.env.NEXT_PUBLIC_APP_URL
      }\n\nQuestions? godfred@mad-buddy.com`,
    });
    if (!sent.ok) throw new Error("Receipt delivery unavailable.");
    await store.setJSON(
      "receipts/" + reference,
      { at: new Date().toISOString() },
      { onlyIfNew: true }
    );
  }
  return paid;
}
