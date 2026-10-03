import "server-only";
import { createHash } from "node:crypto";
import type { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { ArticleImage } from "./image-model";
import { JOURNAL_IMAGE_UPLOAD_MAX_BYTES } from "./image-model";

type Admin = ReturnType<typeof createSupabaseAdminClient>;
export async function uploadJournalImage(admin: Admin, actorId: string, file: File): Promise<{ ok: boolean; message: string; image?: ArticleImage }> {
  if (!file.size || file.size > JOURNAL_IMAGE_UPLOAD_MAX_BYTES) return { ok: false, message: "Choose a JPEG, PNG, or WebP image smaller than 5 MB." };
  try {
    const { optimizeJournalImage } = await import("./image-processing");
    const output = await optimizeJournalImage(Buffer.from(await file.arrayBuffer()));
    const sha256 = createHash("sha256").update(output.buffer).digest("hex");
    const existing = await admin.from("blog_images").select("id, width, height, bytes").eq("sha256", sha256).maybeSingle();
    if (existing.error) return { ok: false, message: "The image library could not be checked. Try again." };
    if (existing.data) return { ok: true, message: "Existing compressed image reused.", image: { ...existing.data, alt: "", caption: "" } };
    const bucket = admin.storage.from("journal-images");
    const path = `${sha256}.jpg`;
    const { error: uploadError } = await bucket.upload(path, Uint8Array.from(output.buffer).buffer, { contentType: "image/jpeg", upsert: false, cacheControl: "300" });
    // A concurrent identical upload can win. Verify the immutable object bytes
    // rather than overwriting it or trusting a broad 'already exists' message.
    const { data: stored, error: downloadError } = await bucket.download(path);
    if (downloadError || !stored || createHash("sha256").update(Buffer.from(await stored.arrayBuffer())).digest("hex") !== sha256) {
      return { ok: false, message: uploadError ? "Image upload failed. Try again." : "The stored image could not be verified. Try again." };
    }
    const { data, error } = await admin.from("blog_images").insert({ sha256, width: output.width, height: output.height, bytes: output.bytes, created_by: actorId }).select("id, width, height, bytes").single();
    if (!error && data) return { ok: true, message: `Image ready (${Math.ceil(data.bytes / 1024)} KB). Save the draft to keep it in this article.`, image: { ...data, alt: "", caption: "" } };
    if (error?.code === "23505") {
      const { data: winner } = await admin.from("blog_images").select("id, width, height, bytes").eq("sha256", sha256).maybeSingle();
      if (winner) return { ok: true, message: "Existing compressed image reused.", image: { ...winner, alt: "", caption: "" } };
    }
    return { ok: false, message: "The image could not be registered. Try uploading it again; the compressed file can be reused." };
  } catch (error) {
    const message = error instanceof Error && /^(Choose|That image)/.test(error.message) ? error.message : "That image could not be processed. Choose a different JPEG, PNG, or WebP.";
    return { ok: false, message };
  }
}
