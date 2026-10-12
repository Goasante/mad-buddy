import { invalidMutationOriginResponse } from "@/lib/security/csrf";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { bookCookieName, matchesBookProof, signBookDownload } from "@/lib/books/security";
import { bookReady, bookSigningSecret, finalizeBookPayment, getBookOrder } from "@/lib/books/service";
import { bookPrivateHeaders, guardBookRequest, readBookJson } from "@/lib/books/http";

export const runtime = "nodejs";
const schema = z.object({ reference: z.string().regex(/^MAB-[a-f0-9-]{36}$/) }).strict();
export async function POST(request: Request) {
  const originError = invalidMutationOriginResponse(request); if (originError) return originError;
  const guard = await guardBookRequest(request, "books.verify"); if (guard) return guard;
  const parsed = schema.safeParse(await readBookJson(request));
  if (!parsed.success) return NextResponse.json({ error: "Invalid purchase reference." }, { status: 400, headers: bookPrivateHeaders });
  if (!bookReady()) return NextResponse.json({ error: "Purchase verification is temporarily unavailable." }, { status: 503, headers: bookPrivateHeaders });
  try {
    const order = await getBookOrder(parsed.data.reference);
    const proof = (await cookies()).get(bookCookieName(parsed.data.reference))?.value;
    if (!order || !matchesBookProof(proof, order.browser_proof_hash)) return NextResponse.json({ error: "Use the download link sent to your purchase email, or request a fresh link below." }, { status: 403, headers: bookPrivateHeaders });
    const paid = await finalizeBookPayment(order.reference);
    if (!paid) return NextResponse.json({ error: "Payment has not been confirmed. If you completed payment, wait a moment and try again." }, { status: 409, headers: bookPrivateHeaders });
    return NextResponse.json({ token: signBookDownload(paid.id, bookSigningSecret()) }, { headers: bookPrivateHeaders });
  } catch {
    return NextResponse.json({ error: "Verification is temporarily unavailable. Please try again shortly." }, { status: 503, headers: bookPrivateHeaders });
  }
}
