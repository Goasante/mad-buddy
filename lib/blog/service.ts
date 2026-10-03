import "server-only";
import { cache } from "react";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { articleSchema, type PublishedArticle } from "./model";

// Public readers receive ONLY the published snapshot. Saving a working draft
// never changes the article people see, even when it already has a live URL.
export const listPublishedArticles = cache(async (): Promise<PublishedArticle[]> => {
  const { data, error } = await createSupabaseAdminClient().from("blog_posts")
    .select("published, published_at, published_updated_at").not("published", "is", null)
    .order("published_at", { ascending: false }).limit(200);
  if (error) throw new Error("Articles are temporarily unavailable.");
  return (data ?? []).flatMap((row) => {
    const parsed = articleSchema.safeParse(row.published);
    return parsed.success && row.published_at && row.published_updated_at
      ? [{ ...parsed.data, publishedAt: row.published_at, updatedAt: row.published_updated_at }] : [];
  });
});

export const getPublishedArticle = cache(async (slug: string) => {
  const { data, error } = await createSupabaseAdminClient().from("blog_posts")
    .select("published, published_at, published_updated_at").eq("slug", slug).not("published", "is", null).maybeSingle();
  if (error) throw new Error("The article is temporarily unavailable.");
  const parsed = articleSchema.safeParse(data?.published);
  return parsed.success && data?.published_at && data.published_updated_at
    ? { ...parsed.data, publishedAt: data.published_at, updatedAt: data.published_updated_at } : null;
});
