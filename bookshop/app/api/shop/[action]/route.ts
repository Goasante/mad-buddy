import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { sendMadBuddyEmail } from "@/lib/email/send";
import { stampBookPdf } from "@/lib/books/pdf";
import { configuration, shopStore } from "@/lib/shop/store";
import { sameOrigin, privateHeaders, readToken } from "@/lib/shop/auth";
import { allow } from "@/lib/shop/rate";
import { chargeInput } from "@/lib/shop/schema";
import {
  ready,
  convertedAmount,
  initialize,
  getOrder,
  proofMatches,
  confirm,
  accessToken,
  referenceValid,
} from "@/lib/shop/payments";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
function response(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: privateHeaders });
}
export async function POST(
  request: Request,
  ctx: { params: Promise<{ action: string }> }
) {
  if (!sameOrigin(request))
    return response({ error: "Invalid request origin." }, 403);
  if (Number(request.headers.get("content-length") || 0) > 8192)
    return response({ error: "Request too large." }, 413);
  try {
    const { action } = await ctx.params;
    if (!["checkout", "download", "verify", "recover"].includes(action))
      return response({ error: "Not found." }, 404);
    const raw = await request.text();
    if (Buffer.byteLength(raw) > 8192)
      return response({ error: "Request too large." }, 413);
    const body = JSON.parse(raw);
    if (
      !(await allow(
        request,
        action,
        action === "checkout" ? 5 : action === "recover" ? 3 : 25,
        action === "recover" ? 3600 : 900
      ))
    )
      return response({ error: "Please wait before trying again." }, 429);
    const { config } = await configuration();
    if (action === "checkout") {
      const parsed = chargeInput.safeParse(body);
      if (!parsed.success)
        return response(
          { error: "Check your email and contribution amount." },
          400
        );
      const v = parsed.data;
      const book = config.books.find((b) => b.id === v.bookId && b.published);
      if (!book) return response({ error: "Book not found." }, 404);
      if (!config.settings.paymentsEnabled || !ready())
        return response(
          {
            error:
              "Contributions are temporarily unavailable. You can still download free books.",
          },
          503
        );
      if (v.kind === "purchase" && book.mode !== "paid")
        return response({ error: "This book is free to download." }, 400);
      if (
        v.kind === "support" &&
        (!v.usd || v.rate !== config.settings.ghsPerUsd)
      )
        return response(
          {
            error:
              "The conversion rate changed. Refresh and confirm the updated cedi amount.",
          },
          409
        );
      const amountMinor =
        v.kind === "purchase"
          ? book.priceMinor
          : convertedAmount(v.usd!, config.settings.ghsPerUsd);
      if (
        !Number.isSafeInteger(amountMinor) ||
        amountMinor < 100 ||
        amountMinor > 10000000
      )
        return response({ error: "Amount outside the supported range." }, 400);
      const checkout = await initialize({
        email: v.email,
        kind: v.kind,
        book,
        amountMinor,
      });
      const result = response({
        url: checkout.url,
        reference: checkout.order.reference,
      });
      result.cookies.set("gbs_" + checkout.order.reference, checkout.proof, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: 86400,
      });
      return result;
    }
    if (action === "verify") {
      if (typeof body.reference !== "string" || !referenceValid(body.reference))
        return response({ error: "Invalid reference." }, 400);
      const order = await getOrder(body.reference);
      const proof = (await cookies()).get("gbs_" + body.reference)?.value;
      if (!order || !proofMatches(proof, order.proofHash))
        return response(
          {
            error:
              "Return in the browser used for payment, or use your receipt link.",
          },
          403
        );
      const paid = await confirm(body.reference);
      return paid
        ? response({
            paid: true,
            kind: paid.kind,
            token: paid.kind === "purchase" ? accessToken(paid) : undefined,
            amount: paid.amountMinor,
          })
        : response({ paid: false }, 202);
    }
    if (action === "recover") {
      const email =
        typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
      if (
        typeof body.reference === "string" &&
        referenceValid(body.reference) &&
        /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) &&
        email.length <= 254
      ) {
        try {
          const order = await getOrder(body.reference);
          if (
            order &&
            order.email === email &&
            order.kind === "purchase" &&
            order.status === "paid"
          ) {
            const verified = await confirm(order.reference, false);
            if (verified) {
              const url = new URL("/receipt", process.env.NEXT_PUBLIC_APP_URL!);
              url.searchParams.set("token", accessToken(verified));
              await sendMadBuddyEmail({
                to: email,
                subject: "Your refreshed book access link",
                idempotencyKey:
                  "recovery-" +
                  order.id +
                  "-" +
                  Math.floor(Date.now() / 3600000),
                text:
                  "Your personal book access link (expires in 24 hours): " +
                  url.toString() +
                  "\n\nOrder: " +
                  order.reference,
              });
            }
          }
        } catch {
          console.error("[bookshop] Recovery temporarily unavailable.");
        }
      }
      return response({
        message:
          "If these details match a verified purchase, a fresh link will arrive shortly.",
      });
    }
    if (action === "download") {
      let email = "",
        reference = "",
        file = "",
        bookId = "";
      if (typeof body.token === "string") {
        const claims = readToken(body.token, "purchase");
        if (!claims || typeof claims.ref !== "string")
          return response(
            { error: "This link has expired or is invalid." },
            403
          );
        const order = await confirm(claims.ref, false);
        if (!order || order.kind !== "purchase")
          return response({ error: "Verified payment is required." }, 403);
        email = order.email;
        reference = order.reference;
        file = order.file;
        bookId = order.bookId;
      } else {
        const book = config.books.find(
          (b) => b.id === body.bookId && b.published
        );
        if (!book) return response({ error: "Book not found." }, 404);
        if (book.mode === "paid")
          return response({ error: "Verified payment is required." }, 403);
        file = book.pdf;
        bookId = book.id;
      }
      const bytes =
        file === "seed:acquisition"
          ? await readFile(path.join(process.cwd(), "private/acquisition.pdf"))
          : await shopStore().get("files/" + file.slice(5), {
              type: "arrayBuffer",
            });
      if (!bytes)
        return response(
          { error: "This edition is temporarily unavailable." },
          503
        );
      const pdf = email
        ? await stampBookPdf(new Uint8Array(bytes), email, reference)
        : new Uint8Array(bytes);
      const jar = await cookies();
      let reader: string | null = null;
      if (body.measure === true) {
        reader = jar.get("bookshop_reader")?.value ?? null;
        if (!reader || !/^[a-f0-9-]{36}$/.test(reader)) reader = randomUUID();
      }
      await shopStore().setJSON(
        `downloads/${new Date().toISOString()}/${randomUUID()}`,
        { bookId, reader, at: new Date().toISOString() },
        { onlyIfNew: true }
      );
      const result = new NextResponse(pdf as unknown as BodyInit, {
        headers: {
          ...privateHeaders,
          "Content-Type": "application/pdf",
          "Content-Disposition":
            'attachment; filename="' +
            (config.books.find((b) => b.id === bookId)?.slug || "book") +
            '.pdf"',
          "Content-Length": String(pdf.byteLength),
        },
      });
      if (reader)
        result.cookies.set("bookshop_reader", reader, {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: "lax",
          path: "/",
          maxAge: 365 * 86400,
        });
      else if (jar.has("bookshop_reader"))
        result.cookies.set("bookshop_reader", "", { path: "/", maxAge: 0 });
      return result;
    }
    return response({ error: "Not found." }, 404);
  } catch (error) {
    console.error(
      "[bookshop] request unavailable",
      error instanceof Error ? error.message.slice(0, 120) : "unknown"
    );
    return response(
      { error: "Temporarily unavailable. Please try again shortly." },
      503
    );
  }
}
