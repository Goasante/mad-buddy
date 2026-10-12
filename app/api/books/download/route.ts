import { NextResponse } from "next/server";
import { z } from "zod";
import { MA_BOOK } from "@/lib/books/product";
import { verifyBookDownload } from "@/lib/books/security";
import { assertBookMasterPrivate, bookReady, bookSigningSecret, finalizeBookPayment } from "@/lib/books/service";
import { stampBookPdf } from "@/lib/books/pdf";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { bookPrivateHeaders, guardBookRequest, readBookJson } from "@/lib/books/http";

export const runtime = "nodejs";
const schema = z.object({ token: z.string().max(1024) }).strict();
export async function POST(request: Request) {
  const guard = await guardBookRequest(request, "books.download"); if (guard) return guard;
  if (!bookReady()) return NextResponse.json({ error: "Downloads are temporarily unavailable." }, { status: 503, headers: bookPrivateHeaders });
  const parsed = schema.safeParse(await readBookJson(request));
  const orderId = parsed.success ? verifyBookDownload(parsed.data.token, bookSigningSecret()) : null;
  if (!orderId) return NextResponse.json({ error: "This link is invalid or expired. Request a fresh link using your purchase email." }, { status: 403, headers: bookPrivateHeaders });
  try {
    const admin = createSupabaseAdminClient();
    const { data: order, error } = await admin.from("book_orders").select("*").eq("id", orderId).eq("product", MA_BOOK.id).eq("status", "paid").maybeSingle();
    if (error) throw error;
    if (!order || !await finalizeBookPayment(order.reference, false)) return NextResponse.json({ error: "An active verified purchase is required." }, { status: 403, headers: bookPrivateHeaders });
    await assertBookMasterPrivate();
    const master = await admin.storage.from("book-files").download("ma-prospecting/v1.pdf");
    if (master.error || !master.data) throw new Error("Book storage unavailable.");
    const pdf = await stampBookPdf(new Uint8Array(await master.data.arrayBuffer()), order.email, order.reference);
    return new NextResponse(new Uint8Array(pdf), { headers: { ...bookPrivateHeaders, "Content-Type": "application/pdf", "Content-Disposition": 'attachment; filename="The-MA-Prospecting-Playbook.pdf"' } });
  } catch {
    return NextResponse.json({ error: "Your download could not be prepared. Please try again shortly." }, { status: 503, headers: bookPrivateHeaders });
  }
}
