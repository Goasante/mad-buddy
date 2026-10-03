import Link from "next/link";
import { articleBlocks, BLOG_FEATURES, readingMinutes, type Article } from "@/lib/blog/model";
import { ArticleFigure } from "./article-image";

export function ArticleContent({ article, publishedAt }: { article: Article; publishedAt?: string }) {
  const blocks = articleBlocks(article.body);
  const headings = blocks.filter((block) => block.kind === "heading");
  const feature = BLOG_FEATURES[article.feature];
  return (
    <div className="mx-auto max-w-6xl px-5 pb-20 pt-12 sm:px-8 sm:pt-20">
      <Link href="/blog" className="focus-ring text-sm font-semibold underline underline-offset-4">← All articles</Link>
      <header className="mb-12 mt-10 max-w-4xl">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#a45121] dark:text-[#f2b16f]">{article.category} / Mad Buddy Journal</p>
        <h1 className="mt-5 text-4xl font-semibold leading-[1.08] tracking-[-0.04em] sm:text-6xl">{article.title}</h1>
        <p className="mt-6 max-w-2xl text-lg leading-8 opacity-75">{article.description}</p>
        <div className="mt-7 flex flex-wrap gap-x-4 gap-y-2 text-sm opacity-70">
          <Link href="/godfred" className="focus-ring underline underline-offset-4">Godfred Ofosu Asante</Link>
          {publishedAt ? <time dateTime={publishedAt}>{new Date(publishedAt).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })}</time> : <span>Unpublished draft</span>}
          <span>{readingMinutes(article.body)} min read</span>
        </div>
      </header>
      {article.cover && <ArticleFigure image={article.cover} cover />}
      <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_240px] lg:gap-20">
        <article className="min-w-0 max-w-[720px]">
          {blocks.map((block) => block.kind === "image"
            ? (article.images ?? []).find((image) => image.id === block.imageId)
              ? <ArticleFigure key={block.id} image={(article.images ?? []).find((image) => image.id === block.imageId)!} />
              : <p key={block.id} className="mb-6 text-sm opacity-60">Image unavailable.</p>
            : block.kind === "heading"
            ? <h2 id={block.id} key={block.id} className="mb-5 mt-12 scroll-mt-28 text-2xl font-semibold tracking-tight first:mt-0">{block.text}</h2>
            : block.kind === "list"
              ? <ul key={block.id} className="mb-6 list-disc space-y-3 pl-6 text-[17px] leading-8 opacity-85">{block.items.map((item, i) => <li key={i}>{item}</li>)}</ul>
              : <p key={block.id} className="mb-6 whitespace-pre-line text-[17px] leading-8 opacity-85">{block.text}</p>)}
          <aside className="mt-12 rounded-2xl border border-[#E88C2B]/30 bg-[#E88C2B]/10 p-7 sm:p-9">
            <p className="text-xs font-semibold uppercase tracking-[0.15em]">Try it with {feature.name}</p>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight">{feature.title}</h2>
            <p className="mb-6 mt-3 leading-7 opacity-80">{feature.body}</p>
            <Link href="/signup" className="focus-ring inline-flex min-h-12 items-center rounded-full bg-[#4E0401] px-6 text-sm font-semibold text-white dark:bg-[#E88C2B] dark:text-[#2A120A]">Get started with Mad Buddy →</Link>
          </aside>
          <p className="mt-7 text-sm leading-6 opacity-70">Before meeting someone new, read our <Link href="/safety" className="focus-ring underline underline-offset-4">safety guide</Link>. Learn more about <Link href="/privacy" className="focus-ring underline underline-offset-4">your privacy choices</Link>.</p>
        </article>
        <aside className="order-first lg:order-last">
          <div className="sticky top-28 border-t border-current/15 pt-5">
            <p className="mb-4 text-xs font-semibold uppercase tracking-[0.15em] opacity-60">In this article</p>
            <nav aria-label="Article contents" className="space-y-3">{headings.map((heading) => <a key={heading.id} href={`#${heading.id}`} className="focus-ring block text-sm leading-6 opacity-75 hover:opacity-100">{heading.text}</a>)}</nav>
          </div>
        </aside>
      </div>
    </div>
  );
}
