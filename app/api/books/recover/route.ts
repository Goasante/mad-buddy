import { NextResponse } from "next/server";
import { z } from "zod";
import { MA_BOOK } from "@/lib/books/product";
import { hashBookProof, normalizeBookEmail } from "@/lib/books/security";
import { bookReady, emailBookAccess, finalizeBookPayment } from "@/lib/books/service";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import { bookPrivateHeaders, guardBookRequest, readBookJson } from "@/lib/books/http";

export const runtime = "nodejs";
const schema = z.object({ email: z.string().max(254) }).strict();
export async function POST(request: Request) {
  const guard = await guardBookRequest(request, "books.recover"); if (guard) return guard;
  const parsed = schema.safeParse(await readBookJson(request));
  const email = parsed.success ? normalizeBookEmail(parsed.data.email) : null;
  if (!email) return NextResponse.json({ error: "Enter a valid purchase email." }, { status: 400, headers: bookPrivateHeaders });
  if (!bookReady()) return NextResponse.json({ error: "Email delivery is temporarily unavailable." }, { status: 503, headers: bookPrivateHeaders });
  const limit = await consumeRateLimit({ action: "books.recover.email", ipHash: hashBookProof(email) });
  if (!limit.allowed) return NextResponse.json({ message: "If a verified purchase matches this email, a fresh link will be sent." }, { status: 202, headers: bookPrivateHeaders });
  try {
    // Include pending rows: a buyer may have closed checkout before the callback
    // and the webhook may be delayed. Only provider-verified paid rows get links.
    const { data: orders, error } = await createSupabaseAdminClient().from("book_orders").select("*")
      .eq("product", MA_BOOK.id).eq("email", email).neq("status", "revoked").order("created_at", { ascending: false }).limit(3);
    if (error) throw error;
    for (const order of orders ?? []) {
      const paid = await finalizeBookPayment(order.reference, false);
      if (paid) await emailBookAccess(paid.id, paid.email, paid.reference, `book-recovery-${paid.id}-${Math.floor(Date.now() / 900_000)}`);
    }
    return NextResponse.json({ message: "If a verified purchase matches this email, a fresh link will be sent. Check your inbox and spam folder." }, { status: 202, headers: bookPrivateHeaders });
  } catch {
    return NextResponse.json({ error: "Email delivery is temporarily unavailable. Please try again shortly." }, { status: 503, headers: bookPrivateHeaders });
  }
}
