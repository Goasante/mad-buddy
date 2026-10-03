import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { PublicPageShell } from "@/components/front-door/public-shell";
import { ArticleContent } from "@/components/blog/article-content";
import { getPublishedArticle, listPublishedArticles } from "@/lib/blog/service";
import { jsonLdString } from "@/lib/blog/model";
import { absoluteUrl } from "@/lib/seo";
import Link from "next/link";
import type { Route } from "next";

export const dynamic = "force-dynamic";
type Props = { params: Promise<{ slug: string }> };
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const article = await getPublishedArticle(slug);
  if (!article) return { title: "Article not found", robots: { index: false, follow: false } };
  return {
    title: article.title, description: article.description,
    alternates: { canonical: `/blog/${article.slug}` },
    openGraph: { type: "article", title: article.title, description: article.description, url: `/blog/${article.slug}`, publishedTime: article.publishedAt, modifiedTime: article.updatedAt, authors: [absoluteUrl("/godfred")] }
  };
}
export default async function ArticlePage({ params }: Props) {
  const { slug } = await params;
  const article = await getPublishedArticle(slug);
  if (!article) notFound();
  const related = (await listPublishedArticles()).filter((item) => item.slug !== slug).slice(0, 2);
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  const structured = {
    "@context": "https://schema.org", "@type": "BlogPosting",
    headline: article.title, description: article.description,
    datePublished: article.publishedAt, dateModified: article.updatedAt,
    mainEntityOfPage: absoluteUrl(`/blog/${article.slug}`),
    author: { "@type": "Person", name: "Godfred Ofosu Asante", url: absoluteUrl("/godfred") },
    publisher: { "@type": "Organization", name: "Mad Buddy", url: absoluteUrl("/") }
  };
  return <PublicPageShell>
    <script type="application/ld+json" nonce={nonce} dangerouslySetInnerHTML={{ __html: jsonLdString(structured) }} />
    <ArticleContent article={article} publishedAt={article.publishedAt} />
    {related.length > 0 && <section className="mx-auto max-w-6xl border-t border-current/15 px-5 py-12 sm:px-8"><h2 className="text-2xl font-semibold">Keep reading</h2><div className="mt-6 grid gap-6 sm:grid-cols-2">{related.map((item) => <Link key={item.slug} href={`/blog/${item.slug}` as Route} className="focus-ring rounded-xl border border-current/15 p-6 font-semibold">{item.title} →</Link>)}</div></section>}
  </PublicPageShell>;
}
