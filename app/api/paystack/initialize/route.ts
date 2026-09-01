import { NextResponse } from "next/server";

/**
 * Retired consumer endpoint. Plus/Pro checkout is no longer a product path.
 * Use /api/access/checkout, which accepts only the stable mad_buddy_access id
 * and derives amount/currency/Paystack plan from server authority.
 */
export async function POST() {
  return NextResponse.json(
    { error: "This checkout endpoint has been retired. Use Mad Buddy Access checkout." },
    { status: 410 }
  );
}
