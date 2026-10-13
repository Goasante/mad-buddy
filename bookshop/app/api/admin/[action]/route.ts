import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import {
  ADMIN_COOKIE,
  adminSession,
  isAdmin,
  validPassword,
  sameOrigin,
  privateHeaders,
} from "@/lib/shop/auth";
import { allow } from "@/lib/shop/rate";
import {
  configuration,
  saveConfiguration,
  shopStore,
  audit,
  records,
} from "@/lib/shop/store";
import { configSchema, type Order } from "@/lib/shop/schema";
import { confirm } from "@/lib/shop/payments";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const response = (data: unknown, status = 200) =>
  NextResponse.json(data, { status, headers: privateHeaders });
export async function GET(
  _: Request,
  ctx: { params: Promise<{ action: string }> }
) {
  if (!(await isAdmin())) return response({ error: "Sign in required." }, 401);
  try {
    const { action } = await ctx.params;
    if (action === "config") return response(await configuration());
    if (action === "reports") {
      const [orders, downloads, events] = await Promise.all([
        records<Order>("orders/"),
        records<{ bookId: string; reader: string; at: string }>("downloads/"),
        records<{ action: string; at: string }>("audit/", 250),
      ]);
      const cutoff = Date.now() - 365 * 86400000;
      const ds = downloads.rows.filter((d) => Date.parse(d.at) > cutoff);
      const paid = orders.rows.filter((o) => o.status === "paid");
      return response({
        orders: orders.rows.sort((a, b) =>
          b.createdAt.localeCompare(a.createdAt)
        ),
        downloads: ds.length,
        readers: new Set(ds.map((d) => d.reader).filter(Boolean)).size,
        contributions: paid
          .filter((o) => o.kind === "support")
          .reduce((n, o) => n + o.amountMinor, 0),
        sales: paid
          .filter((o) => o.kind === "purchase")
          .reduce((n, o) => n + o.amountMinor, 0),
        byBook: ds.reduce<Record<string, number>>(
          (a, d) => ({ ...a, [d.bookId]: (a[d.bookId] || 0) + 1 }),
          {}
        ),
        events: events.rows.sort((a, b) => b.at.localeCompare(a.at)),
        truncated: orders.truncated || downloads.truncated || events.truncated,
      });
    }
    return response({ error: "Not found." }, 404);
  } catch {
    return response({ error: "Reports are temporarily unavailable." }, 503);
  }
}
export async function POST(
  request: Request,
  ctx: { params: Promise<{ action: string }> }
) {
  if (!sameOrigin(request))
    return response({ error: "Invalid request origin." }, 403);
  const { action } = await ctx.params;
  try {
    if (action === "login") {
      if (Number(request.headers.get("content-length") || 0) > 2048)
        return response({ error: "Invalid login." }, 400);
      if (!(await allow(request, "admin-login", 5, 900)))
        return response(
          { error: "Too many attempts. Try again in 15 minutes." },
          429
        );
      const loginBody = await request.text();
      if (Buffer.byteLength(loginBody) > 2048)
        return response({ error: "Invalid login." }, 400);
      const { password } = JSON.parse(loginBody);
      if (typeof password !== "string" || !validPassword(password))
        return response({ error: "Unable to sign in." }, 401);
      await audit("admin.login");
      const result = response({ ok: true });
      result.cookies.set(ADMIN_COOKIE, adminSession(), {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "strict",
        path: "/",
        maxAge: 8 * 3600,
      });
      return result;
    }
    if (!(await isAdmin()))
      return response({ error: "Sign in required." }, 401);
    if (action === "logout") {
      const result = response({ ok: true });
      result.cookies.set(ADMIN_COOKIE, "", { path: "/", maxAge: 0 });
      return result;
    }
    if (action === "upload") {
      if (
        Number(request.headers.get("content-length") || 0) >
        4 * 1024 * 1024 + 8192
      )
        return response({ error: "Maximum upload is 4 MB." }, 413);
      const form = await request.formData();
      const file = form.get("file");
      if (!(file instanceof File) || file.size > 4 * 1024 * 1024 || !file.size)
        return response({ error: "Choose a file under 4 MB." }, 400);
      const bytes = new Uint8Array(await file.arrayBuffer());
      let type = "",
        pages = 0;
      if (new TextDecoder().decode(bytes.slice(0, 5)) === "%PDF-") {
        const pdf = await PDFDocument.load(bytes);
        pages = pdf.getPageCount();
        type = "application/pdf";
      } else if (bytes[0] === 0xff && bytes[1] === 0xd8) type = "image/jpeg";
      else if (
        bytes[0] === 137 &&
        bytes[1] === 80 &&
        bytes[2] === 78 &&
        bytes[3] === 71
      )
        type = "image/png";
      else if (
        new TextDecoder().decode(bytes.slice(0, 4)) === "RIFF" &&
        new TextDecoder().decode(bytes.slice(8, 12)) === "WEBP"
      )
        type = "image/webp";
      else
        return response({ error: "Use a valid PDF, JPEG, PNG or WebP." }, 400);
      const id = randomUUID();
      await shopStore().set(
        (pages ? "files/" : "assets/") + id,
        bytes.buffer as ArrayBuffer,
        { metadata: { type }, onlyIfNew: true }
      );
      await audit("asset.uploaded", id);
      return response({ asset: (pages ? "file:" : "asset:") + id, pages });
    }
    if (Number(request.headers.get("content-length") || 0) > 128 * 1024)
      return response({ error: "Request too large." }, 413);
    const text = await request.text();
    if (Buffer.byteLength(text) > 128 * 1024)
      return response({ error: "Request too large." }, 413);
    const body = JSON.parse(text);
    if (action === "config") {
      const parsed = configSchema.safeParse(body.config);
      if (!parsed.success || typeof body.etag !== "string")
        return response(
          {
            error: parsed.success
              ? "Missing version."
              : parsed.error.issues[0].message,
          },
          400
        );
      for (const book of parsed.data.books) {
        if (
          book.published &&
          book.id !== "acquisition-v1" &&
          book.pdf === "seed:acquisition"
        )
          return response(
            { error: "Upload this book’s own PDF before publishing." },
            400
          );
        if (
          book.published &&
          book.pdf.startsWith("file:") &&
          !(await shopStore().getMetadata("files/" + book.pdf.slice(5)))
        )
          return response({ error: "PDF upload could not be found." }, 400);
        if (book.mode === "paid" && book.pdf === "seed:acquisition")
          return response(
            {
              error:
                "Upload a new private edition before making this previously free book paid.",
            },
            400
          );
      }
      return response(await saveConfiguration(parsed.data, body.etag));
    }
    if (action === "reconcile") {
      if (
        typeof body.reference !== "string" ||
        !/^GBS-[a-f0-9-]{36}$/.test(body.reference)
      )
        return response({ error: "Invalid reference." }, 400);
      const order = await confirm(body.reference);
      await audit("payment.rechecked", body.reference);
      return response({ paid: Boolean(order) });
    }
    return response({ error: "Not found." }, 404);
  } catch (error) {
    return response(
      {
        error:
          error instanceof Error && error.message === "CONFLICT"
            ? "Another edit was saved. Reload before editing again."
            : "Unable to complete this action.",
      },
      error instanceof Error && error.message === "CONFLICT" ? 409 : 503
    );
  }
}
