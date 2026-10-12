import { invalidMutationOriginResponse } from "@/lib/security/csrf";
import { NextResponse } from "next/server";
import { z } from "zod";
import { MA_BOOK } from "@/lib/books/product";
import { bookReady, initializeBookCheckout } from "@/lib/books/service";
import { bookCookieName, normalizeBookEmail } from "@/lib/books/security";
import { bookPrivateHeaders, guardBookRequest, readBookJson } from "@/lib/books/http";

export const runtime = "nodejs";
const schema = z.object({ product: z.literal(MA_BOOK.id), email: z.string().max(254) }).strict();
export async function POST(request: Request) {
  const originError = invalidMutationOriginResponse(request); if (originError) return originError;
  const guard = await guardBookRequest(request, "books.checkout"); if (guard) return guard;
  const parsed = schema.safeParse(await readBookJson(request));
  const email = parsed.success ? normalizeBookEmail(parsed.data.email) : null;
  if (!email) return NextResponse.json({ error: "Enter a valid purchase email." }, { status: 400, headers: bookPrivateHeaders });
  if (!bookReady()) return NextResponse.json({ error: "Book purchases are not open yet. Nothing has been charged." }, { status: 503, headers: bookPrivateHeaders });
  try {
    const checkout = await initializeBookCheckout(email);
    const response = NextResponse.json({ authorizationUrl: checkout.url }, { headers: bookPrivateHeaders });
    response.cookies.set(bookCookieName(checkout.reference), checkout.proof, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 24 * 60 * 60 });
    return response;
  } catch {
    return NextResponse.json({ error: "We could not open checkout. Please try again." }, { status: 503, headers: bookPrivateHeaders });
  }
}
