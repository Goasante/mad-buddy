import { NextResponse } from "next/server";
import { confirm, PRODUCT, referenceValid } from "@/lib/shop/payments";
import type { BookPayment } from "@/lib/books/security";
import { bookPrivateHeaders } from "@/lib/books/http";
import { getPaystackWebhookSecret } from "@/lib/paystack/config";
import { validPaystackSignature } from "@/lib/paystack/signature";

export const runtime = "nodejs";
const MAX_BYTES = 256 * 1024;

export async function POST(request: Request) {
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BYTES) {
    return NextResponse.json(
      { error: "Payload too large." },
      { status: 413, headers: bookPrivateHeaders }
    );
  }
  const body = await request.text();
  if (Buffer.byteLength(body, "utf8") > MAX_BYTES) {
    return NextResponse.json(
      { error: "Payload too large." },
      { status: 413, headers: bookPrivateHeaders }
    );
  }
  const key = getPaystackWebhookSecret();
  if (!key)
    return NextResponse.json(
      { error: "Webhook not configured." },
      { status: 503, headers: bookPrivateHeaders }
    );
  const signature = request.headers.get("x-paystack-signature");
  if (!validPaystackSignature(body, signature, key)) {
    return NextResponse.json(
      { error: "Invalid signature." },
      { status: 400, headers: bookPrivateHeaders }
    );
  }
  try {
    const event = JSON.parse(body) as { event?: unknown; data?: unknown };
    if (
      typeof event.event !== "string" ||
      !event.data ||
      typeof event.data !== "object" ||
      Array.isArray(event.data)
    ) {
      return NextResponse.json(
        { error: "Invalid event." },
        { status: 400, headers: bookPrivateHeaders }
      );
    }
    const payment = event.data as BookPayment;
    let metadata = payment.metadata;
    if (typeof metadata === "string") {
      try {
        metadata = JSON.parse(metadata);
      } catch {
        metadata = null;
      }
    }
    if (
      metadata &&
      typeof metadata === "object" &&
      metadata.product === PRODUCT
    ) {
      if (event.event === "charge.success") {
        if (
          !payment.reference ||
          !referenceValid(payment.reference) ||
          !(await confirm(payment.reference))
        )
          throw new Error("Payment verification unavailable.");
      }
    } else if (
      metadata &&
      typeof metadata === "object" &&
      metadata.product === "ma_prospecting_playbook_v1"
    ) {
      return NextResponse.json(
        { error: "Legacy checkout requires manual reconciliation." },
        { status: 503, headers: bookPrivateHeaders }
      );
    } else {
      // Paystack provides one webhook per merchant. Preserve app events without
      // routing book fulfilment back through the app's hosting.
      const appResult = await fetch(
        "https://mad-buddy.com/api/paystack/webhook",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-paystack-signature": signature!,
          },
          body,
          redirect: "error",
          signal: AbortSignal.timeout(15_000),
          cache: "no-store",
        }
      );
      if (!appResult.ok) throw new Error("App event forwarding unavailable.");
    }
    return NextResponse.json(
      { received: true },
      { headers: bookPrivateHeaders }
    );
  } catch {
    return NextResponse.json(
      { error: "Event delivery temporarily unavailable." },
      { status: 503, headers: bookPrivateHeaders }
    );
  }
}
