import type { MetadataRoute } from "next";
import { absoluteUrl } from "@/lib/seo";
import { listPublishedArticles } from "@/lib/blog/service";

export const dynamic = "force-dynamic";

const lastModified = new Date("2026-08-30T00:00:00.000Z");

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const articles = await listPublishedArticles();
  return [
    { url: absoluteUrl("/blog"), changeFrequency: "weekly", priority: 0.7 },
    ...articles.map((article) => ({ url: absoluteUrl(`/blog/${article.slug}`), lastModified: new Date(article.updatedAt), changeFrequency: "monthly" as const, priority: 0.6 })),
    { url: absoluteUrl("/"), lastModified, changeFrequency: "monthly", priority: 1 },
    { url: absoluteUrl("/about"), lastModified, changeFrequency: "yearly", priority: 0.5 },
    { url: absoluteUrl("/godfred"), lastModified: new Date("2026-10-03T00:00:00.000Z"), changeFrequency: "monthly", priority: 0.6 },
    { url: absoluteUrl("/safety"), lastModified, changeFrequency: "monthly", priority: 0.6 },
    { url: absoluteUrl("/faq"), lastModified, changeFrequency: "monthly", priority: 0.5 },
    { url: absoluteUrl("/support"), lastModified, changeFrequency: "monthly", priority: 0.5 },
    { url: absoluteUrl("/pricing"), lastModified, changeFrequency: "monthly", priority: 0.7 },
    { url: absoluteUrl("/privacy"), lastModified, changeFrequency: "yearly", priority: 0.4 },
    { url: absoluteUrl("/terms"), lastModified, changeFrequency: "yearly", priority: 0.4 }
  ];
}
