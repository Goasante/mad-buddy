import "server-only";
import { randomBytes, randomUUID } from "node:crypto";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { paystackRequest, type PaystackInitializeTransaction } from "@/lib/paystack/client";
import { sendMadBuddyEmail } from "@/lib/email/send";
import { absoluteUrl } from "@/lib/seo";
import { MA_BOOK } from "./product";
import { bookMetadata, hashBookProof, isVerifiedBookPayment, signBookDownload, type BookPayment } from "./security";

export function bookSalesEnabled() {
  return process.env.BOOK_SALES_ENABLED === "true" && Boolean(process.env.PAYSTACK_SECRET_KEY?.trim()) &&
    Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()) && Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()) &&
    Boolean(process.env.RESEND_API_KEY?.trim()) && Boolean(process.env.MAD_BUDDY_EMAIL_FROM?.trim());
}
export function bookSigningSecret() {
  const secret = process.env.BOOK_DOWNLOAD_SECRET?.trim();
  if (!secret || secret.length < 32) throw new Error("Book signing key is not configured.");
  return secret;
}
export function bookReady() {
  return bookSalesEnabled() && (process.env.BOOK_DOWNLOAD_SECRET?.trim().length ?? 0) >= 32;
}
export async function assertBookMasterPrivate() {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.storage.getBucket("book-files");
  if (error || !data || data.public) throw new Error("Private book storage is unavailable.");
  const { data: files, error: listError } = await admin.storage.from("book-files").list("ma-prospecting", { limit: 10, search: "v1.pdf" });
  if (listError || !files?.some(file => file.name === "v1.pdf")) throw new Error("Book master is unavailable.");
}
export async function initializeBookCheckout(email: string) {
  if (!bookReady()) throw new Error("Book checkout is not configured.");
  await assertBookMasterPrivate();
  const admin = createSupabaseAdminClient();
  const id = randomUUID(); const reference = `MAB-${randomUUID()}`; const proof = randomBytes(32).toString("hex");
  const { error } = await admin.from("book_orders").insert({ id, reference, email, product: MA_BOOK.id,
    amount_minor: MA_BOOK.amountMinor, currency: MA_BOOK.currency, browser_proof_hash: hashBookProof(proof) });
  if (error) throw new Error("Book order could not be recorded.");
  const transaction = await paystackRequest<PaystackInitializeTransaction>("/transaction/initialize", { method: "POST", body: {
    email, amount: MA_BOOK.amountMinor, currency: MA_BOOK.currency, reference,
    callback_url: absoluteUrl(`${MA_BOOK.path}/access`),
    metadata: JSON.stringify({ product: MA_BOOK.id, book_order_id: id })
  } });
  const url = new URL(transaction.authorization_url);
  if (url.protocol !== "https:" || url.hostname !== "checkout.paystack.com" || transaction.reference !== reference) throw new Error("Unexpected checkout response.");
  return { reference, proof, url: transaction.authorization_url };
}
export async function getBookOrder(reference: string) {
  if (!/^MAB-[a-f0-9-]{36}$/.test(reference)) return null;
  const { data, error } = await createSupabaseAdminClient().from("book_orders").select("*").eq("reference", reference).eq("product", MA_BOOK.id).maybeSingle();
  if (error) throw new Error("Order lookup unavailable.");
  return data;
}
export async function verifyBookPayment(reference: string) {
  return paystackRequest<BookPayment>(`/transaction/verify/${encodeURIComponent(reference)}`, { cache: "no-store" });
}
export async function finalizeBookPayment(reference: string, sendReceipt = true) {
  const order = await getBookOrder(reference);
  if (!order || order.status === "revoked") return null;
  const payment = await verifyBookPayment(reference);
  const live = process.env.PAYSTACK_SECRET_KEY?.startsWith("sk_live_") === true;
  if (!isVerifiedBookPayment(payment, order, live)) return null;
  const admin = createSupabaseAdminClient();
  const { data: paid, error } = await admin.from("book_orders").update({ status: "paid", paid_at: order.paid_at ?? new Date().toISOString() })
    .eq("id", order.id).neq("status", "revoked").select("*").maybeSingle();
  if (error) throw new Error("Payment could not be recorded.");
  if (!paid) return null;
  if (sendReceipt && !paid.receipt_sent_at) {
    const sent = await emailBookAccess(paid.id, paid.email, paid.reference, `book-receipt-${paid.id}`);
    if (!sent.ok) throw new Error("Book receipt delivery unavailable.");
    const { error: receiptError } = await admin.from("book_orders").update({ receipt_sent_at: new Date().toISOString() }).eq("id", paid.id);
    if (receiptError) throw new Error("Receipt delivery could not be recorded.");
  }
  return paid;
}
export function bookAccessUrl(orderId: string) {
  return absoluteUrl(`${MA_BOOK.path}/access?token=${encodeURIComponent(signBookDownload(orderId, bookSigningSecret()))}`);
}
export async function emailBookAccess(orderId: string, email: string, reference: string, idempotencyKey: string) {
  return sendMadBuddyEmail({ to: email, subject: "Your copy of The M&A Prospecting Playbook", idempotencyKey,
    text: `Thank you for purchasing The M&A Prospecting Playbook by Godfred Ofosu Asante.\n\nOrder: ${reference}\nPrice: GHS 200.00 (one-time purchase)\n\nDownload your personal copy: ${bookAccessUrl(orderId)}\n\nThis private link expires in 24 hours. If it expires, request a fresh link at ${absoluteUrl(`${MA_BOOK.path}/access`)} using this purchase email.\n\nYour PDF is personalised with your email and order reference. Licensed for your own use; please do not redistribute.\n\nQuestions? Contact godfred@mad-buddy.com.` });
}
export async function handleBookWebhook(event: { event: string; data: BookPayment }) {
  if (bookMetadata(event.data)?.product !== MA_BOOK.id) return false;
  if (event.event === "charge.success" && event.data.reference) {
    if (!bookReady()) throw new Error("Book delivery unavailable.");
    const order = await finalizeBookPayment(event.data.reference);
    if (!order) throw new Error("Book payment failed verification.");
  }
  return true;
}
