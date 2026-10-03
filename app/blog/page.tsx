import Link from "next/link";
import type { Metadata, Route } from "next";
import { PublicPageShell } from "@/components/front-door/public-shell";
import { listPublishedArticles } from "@/lib/blog/service";
import { readingMinutes } from "@/lib/blog/model";
import Image from "next/image";
import { articleImageUrl } from "@/lib/blog/image-model";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Journal — Friendship, privacy & real-life connection",
  description: "Practical guides to making friends in Accra, staying close without sharing exact locations, and turning conversations into real plans.",
  alternates: { canonical: "/blog" },
  openGraph: { title: "The Mad Buddy Journal", description: "Less scrolling. More showing up.", url: "/blog" }
};

export default async function BlogPage() {
  const articles = await listPublishedArticles();
  return <PublicPageShell>
    <section className="mx-auto max-w-7xl px-5 pb-14 pt-16 sm:px-8 sm:pb-20 sm:pt-24">
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#a45121] dark:text-[#f2b16f]">The Mad Buddy Journal</p>
      <div className="mt-5 grid gap-8 border-b border-current/15 pb-12 lg:grid-cols-[1.4fr_1fr] lg:items-end">
        <h1 className="max-w-3xl text-5xl font-semibold leading-[1.04] tracking-[-0.05em] sm:text-7xl">Good connections.<br /><span className="text-[#a45121] dark:text-[#f2b16f]">Real life.</span></h1>
        <p className="max-w-md text-lg leading-8 opacity-75">Useful ideas for making new friends, keeping your privacy, and actually getting together. Written for people, not feeds.</p>
      </div>
      <p className="mt-8 text-xs font-semibold uppercase tracking-[0.14em] opacity-60">Latest articles</p>
      <div className="mt-5 grid gap-6 md:grid-cols-2">
        {articles.map((article, index) => <Link key={article.slug} href={`/blog/${article.slug}` as Route} className={`focus-ring group rounded-2xl border border-current/15 p-7 transition-colors hover:border-[#a45121]/60 sm:p-10 ${index === 0 ? "bg-[#E88C2B]/10" : ""}`}>
          {article.cover && <Image src={articleImageUrl(article.cover.id)} alt={article.cover.alt} width={article.cover.width} height={article.cover.height} unoptimized loading="lazy" className="mb-7 aspect-[16/9] w-full rounded-xl object-cover" />}
          <div className="flex items-center justify-between gap-4 text-xs font-semibold uppercase tracking-[0.12em] opacity-65"><span>{article.category}</span><span>{readingMinutes(article.body)} min read</span></div>
          <h2 className="mt-8 text-3xl font-semibold leading-tight tracking-[-0.025em]">{article.title}</h2>
          <p className="mt-4 text-base leading-7 opacity-75">{article.description}</p>
          <p className="mt-8 text-sm font-semibold">Read the guide <span aria-hidden="true">↗</span></p>
        </Link>)}
      </div>
      {!articles.length && <p className="py-16 text-xl">Our first guides are on their way. Until then, <Link className="underline" href="/about">get to know Mad Buddy</Link>.</p>}
    </section>
  </PublicPageShell>;
}
