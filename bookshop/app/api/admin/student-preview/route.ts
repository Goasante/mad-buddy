import { createHash } from "node:crypto";
import { isAdmin, privateHeaders, sameOrigin } from "@/lib/shop/auth";
import { audit, shopStore } from "@/lib/shop/store";
import { BUYER_ZIP_SHA256, PREVIEW_FILES, PREVIEW_PREFIX } from "@/lib/shop/student-preview-manifest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const reply = (data: unknown, status = 200) => Response.json(data, { status, headers: privateHeaders });
const MAX_BYTES = 4 * 1024 * 1024;

export async function POST(request: Request) {
  if (!sameOrigin(request)) return reply({ error: "Invalid request origin." }, 403);
  if (!(await isAdmin())) return reply({ error: "Sign in required." }, 401);
  if (Number(request.headers.get("content-length") || 0) > MAX_BYTES)
    return reply({ error: "Maximum upload is 4 MB." }, 413);
  try {
    const form = await request.formData();
    const files = form.getAll("files");
    const names = Object.keys(PREVIEW_FILES);
    if (files.length !== names.length) return reply({ error: "Choose all files from the approved extracted buyer package." }, 400);
    const staged: { path: string; data: ArrayBuffer }[] = [];
    const seen = new Set<string>();
    let total = 0;
    for (const file of files) {
      if (!(file instanceof File)) return reply({ error: "Invalid file." }, 400);
      const path = names.find(path => path.split("/").at(-1) === file.name);
      if (!path || seen.has(path)) return reply({ error: "Unexpected or duplicate file." }, 400);
      const expected = PREVIEW_FILES[path];
      total += file.size;
      if (total > MAX_BYTES || file.size !== expected.size) return reply({ error: "File size does not match the approved edition." }, 400);
      const data = await file.arrayBuffer();
      if (createHash("sha256").update(new Uint8Array(data)).digest("hex") !== expected.sha256)
        return reply({ error: "File does not match the approved edition." }, 400);
      seen.add(path);
      staged.push({ path, data });
    }
    // Validate the entire package before writing; readiness is published only after every write succeeds.
    const store = shopStore();
    for (let i = 0; i < staged.length; i += 8) {
      await Promise.all(staged.slice(i, i + 8).map(({ path, data }) =>
        store.set(PREVIEW_PREFIX + path, data, { onlyIfNew: true, metadata: { sha256: PREVIEW_FILES[path].sha256 } })
      ));
    }
    await store.setJSON(PREVIEW_PREFIX + "ready", { packageSha256: BUYER_ZIP_SHA256, files: names.length }, { onlyIfNew: true });
    await audit("private-preview.ready", "student-edge-1.0.0");
    return reply({ ok: true, files: names.length });
  } catch {
    return reply({ error: "Preview upload could not be completed. It is safe to retry the unchanged package." }, 503);
  }
}
