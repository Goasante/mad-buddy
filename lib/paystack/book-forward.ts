import "server-only";
import { NextResponse } from "next/server";
import { MA_BOOK } from "@/lib/books/product";

// Call only after validating Paystack's signature over the unchanged body.
export async function forwardBookWebhook(
  body: string,
  signature: string,
  metadata: unknown
) {
  let details = metadata;
  if (typeof details === "string") {
    try {
      details = JSON.parse(details);
    } catch {
      return null;
    }
  }
  if (
    !details ||
    typeof details !== "object" ||
    Array.isArray(details) ||
    ![MA_BOOK.id, "godfred_bookshop_v2"].includes(
      String((details as Record<string, unknown>).product)
    )
  )
    return null;

  try {
    const response = await fetch(
      "https://books.mad-buddy.com/api/paystack/webhook",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-paystack-signature": signature,
        },
        body,
        redirect: "error",
        signal: AbortSignal.timeout(15_000),
      }
    );
    return NextResponse.json(
      response.ok
        ? { received: true }
        : { error: "Book delivery is temporarily unavailable." },
      {
        status: response.ok ? 200 : 503,
        headers: { "Cache-Control": "private, no-store" },
      }
    );
  } catch {
    return NextResponse.json(
      { error: "Book delivery is temporarily unavailable." },
      { status: 503 }
    );
  }
}
