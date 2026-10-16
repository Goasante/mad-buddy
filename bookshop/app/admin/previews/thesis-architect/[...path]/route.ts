import { createHash } from "node:crypto";
import { isAdmin, privateHeaders } from "@/lib/shop/auth";
import { shopStore } from "@/lib/shop/store";
import { BUYER_ZIP_SHA256, PREVIEW_FILES, PREVIEW_PREFIX, PREVIEW_TYPES, READER_SCRIPT_HASH, previewPath } from "@/lib/shop/thesis-preview-manifest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { ...privateHeaders, "X-Robots-Tag": "noindex, nofollow, noarchive", "Netlify-CDN-Cache-Control": "no-store", Vary: "Cookie" };
export async function GET(_: Request, ctx: { params: Promise<{ path: string[] }> }) {
  if (!(await isAdmin())) return new Response('<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Private preview</title><body><h1>Private preview</h1><p>Sign in with the existing publishing-desk owner account to view this book.</p><a href="/admin/previews">Sign in to the publishing desk</a></body></html>', { status: 401, headers: { ...headers, "Content-Type": "text/html; charset=utf-8" } });
  const path = previewPath((await ctx.params).path);
  if (!path) return new Response(null, { status: 404, headers });
  try {
    const store = shopStore();
    const ready = await store.get(PREVIEW_PREFIX + "ready", { type: "json" });
    if (ready?.packageSha256 !== BUYER_ZIP_SHA256) return new Response("This private preview has not been uploaded yet.", { status: 404, headers });
    const entry = await store.getWithMetadata(PREVIEW_PREFIX + path, { type: "arrayBuffer" });
    if (!entry || entry.metadata.sha256 !== PREVIEW_FILES[path].sha256) return new Response(null, { status: 404, headers });
    if (entry.data.byteLength !== PREVIEW_FILES[path].size || createHash("sha256").update(new Uint8Array(entry.data)).digest("hex") !== PREVIEW_FILES[path].sha256) return new Response(null, { status: 404, headers });
    const ext = path.split(".").at(-1)!;
    return new Response(entry.data, { headers: {
      ...headers,
      "Content-Type": PREVIEW_TYPES[ext],
      "Content-Disposition": `${["xlsx", "docx", "json"].includes(ext) ? "attachment" : "inline"}; filename="${path.split("/").at(-1)}"`,
      ...(ext === "html" ? { "Content-Security-Policy": `default-src 'none'; script-src 'sha256-${READER_SCRIPT_HASH}'; style-src 'unsafe-inline'; img-src data: blob:; object-src 'none'; connect-src 'none'; form-action 'none'; frame-ancestors 'none'; base-uri 'none'` } : {}),
    } });
  } catch {
    return new Response("Private preview is temporarily unavailable.", { status: 503, headers });
  }
}
