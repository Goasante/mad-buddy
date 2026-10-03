import { z } from "zod";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { blogOwnerContext } from "@/lib/blog/admin";
import { JOURNAL_IMAGE_MAX_BYTES } from "@/lib/blog/image-model";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
function missing() { return new Response(null, { status: 404, headers: { "Cache-Control": "private, no-store" } }); }

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return missing();
  const admin = createSupabaseAdminClient();
  const { data: published, error: visibilityError } = await admin.rpc("blog_image_is_published", { p_id: id });
  if (visibilityError) return new Response(null, { status: 503, headers: { "Cache-Control": "private, no-store" } });
  if (!published && !(await blogOwnerContext())) return missing();
  const { data: image, error } = await admin.from("blog_images").select("sha256, bytes").eq("id", id).maybeSingle();
  if (error || !image) return missing();
  const { data: blob, error: downloadError } = await admin.storage.from("journal-images").download(`${image.sha256}.jpg`);
  if (downloadError || !blob || blob.size !== image.bytes || blob.size > JOURNAL_IMAGE_MAX_BYTES) return missing();
  return new Response(await blob.arrayBuffer(), { headers: {
    "Content-Type": "image/jpeg", "Content-Length": String(blob.size),
    "Content-Disposition": 'inline; filename="journal-image.jpg"',
    "Cache-Control": published ? "public, max-age=300, s-maxage=300" : "private, no-store",
    "X-Content-Type-Options": "nosniff", "Vary": "Cookie"
  } });
}
