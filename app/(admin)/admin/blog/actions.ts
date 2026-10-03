"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { blogOwnerContext } from "@/lib/blog/admin";
import { articleSchema, publishIssues } from "@/lib/blog/model";
import { consumeRateLimit, rateLimitMessage } from "@/lib/security/rate-limit";
import { recordAdminAuditEvent } from "@/lib/admin/service";
import type { Json } from "@/lib/supabase/database.types";

const schema = z.object({ id: z.string().uuid().nullable(), version: z.number().int().min(0), article: articleSchema, intent: z.enum(["save", "publish", "unpublish"]) });
export async function saveArticleAction(input: unknown): Promise<{ ok: boolean; message: string; id?: string; version?: number; live?: boolean }> {
  const auth = await blogOwnerContext();
  if (!auth) return { ok: false, message: "Only the owner can manage the journal." };
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Check your article." };
  const { id, version, article, intent } = parsed.data;
  const attached = [...(article.cover ? [article.cover] : []), ...(article.images ?? [])];
  if (attached.length) {
    const ids = [...new Set(attached.map((image) => image.id))];
    const { data: stored, error } = await auth.admin.from("blog_images").select("id, width, height, bytes").in("id", ids);
    if (error || attached.some((image) => !stored?.some((row) => row.id === image.id && row.width === image.width && row.height === image.height && row.bytes === image.bytes))) {
      return { ok: false, message: "An image could not be verified. Upload it again before saving." };
    }
  }
  if (intent === "publish") {
    const issues = publishIssues(article);
    if (issues.length) return { ok: false, message: issues.join(" ") };
  }
  const limit = await consumeRateLimit({ action: "admin.mutate", userId: auth.context.userId });
  if (!limit.allowed) return { ok: false, message: rateLimitMessage(limit.resetAt) };
  const logged = await recordAdminAuditEvent(auth.admin, { actorId: auth.context.userId, actorRole: "owner", action: `blog.${intent}.requested`, targetType: "blog_post", targetId: id ?? undefined, newState: { slug: article.slug, expectedVersion: version } });
  if (!logged) return { ok: false, message: "The action was not recorded, so it was not applied." };
  const { data, error } = await auth.admin.rpc("save_blog_post", { p_id: id, p_version: version, p_draft: article as Json, p_intent: intent, p_actor: auth.context.userId });
  if (error) return { ok: false, message: error.message.includes("Version conflict") ? "This article changed in another tab. Reload before saving; copy your text first." : error.message.includes("duplicate key") ? "That URL is already in use. Choose another slug." : "The article could not be saved. Your text is still in the editor." };
  const result = z.object({ id: z.string().uuid(), version: z.number(), live: z.boolean() }).safeParse(data);
  if (!result.success) return { ok: false, message: "Reload to check the saved article." };
  revalidatePath("/admin/blog");
  revalidatePath(`/admin/blog/${result.data.id}`);
  if (intent !== "save") { revalidatePath("/blog"); revalidatePath(`/blog/${article.slug}`); revalidatePath("/sitemap.xml"); }
  return { ok: true, ...result.data, message: intent === "publish" ? "Published. Your article is live." : intent === "unpublish" ? "Unpublished. Your content and saved versions are retained." : "Draft saved. Live content is unchanged." };
}
