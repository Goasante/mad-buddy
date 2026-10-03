import { notFound } from "next/navigation";
import { z } from "zod";
import { requireBlogOwner } from "@/lib/blog/admin";
import { articleSchema } from "@/lib/blog/model";
import { ArticleEditor } from "@/components/blog/article-editor";
export const dynamic = "force-dynamic";
export default async function EditArticlePage({ params }: { params: Promise<{ id: string }> }) {
  const { admin } = await requireBlogOwner();
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const { data, error } = await admin.from("blog_posts").select("id, draft, version, published").eq("id", id).maybeSingle();
  if (error) throw new Error("The article could not load.");
  const draft = articleSchema.safeParse(data?.draft);
  if (!data || !draft.success) notFound();
  const { data: history, error: historyError } = await admin.from("blog_revisions").select("version, draft, saved_at").eq("post_id", id).order("version", { ascending: false }).limit(30);
  if (historyError) throw new Error("Saved versions could not load.");
  const revisions = (history ?? []).flatMap((row) => { const parsed = articleSchema.safeParse(row.draft); return parsed.success ? [{ version: row.version, savedAt: row.saved_at, article: parsed.data }] : []; });
  return <ArticleEditor key={id} id={id} initial={draft.data} version={data.version} live={!!data.published} revisions={revisions} />;
}
