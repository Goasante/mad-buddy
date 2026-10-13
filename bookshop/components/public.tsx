import Link from "next/link";
import Image from "next/image";
import type { Book, ShopConfig } from "@/lib/shop/schema";
import { BookActions } from "./reader";

export const imageSource = (value: string) =>
  value.startsWith("asset:") ? "/api/assets/" + value.slice(6) : value;

export function Text({ value }: { value: string }) {
  return (
    <>
      {value.split("\n\n").map((paragraph, index) => (
        <p key={index}>{paragraph}</p>
      ))}
    </>
  );
}

export function Shell({
  children,
  config,
}: {
  children: React.ReactNode;
  config: ShopConfig;
}) {
  return (
    <>
      <a className="skip-link" href="#main-content">Skip to content</a>
      <header className="header">
        <Link className="brand-lockup" href="/" aria-label="GOA Books — home">
          <span className="goa-logo" aria-hidden="true">GOA<span>.</span></span>
          <span className="brand-descriptor">Books &amp;<br />field guides</span>
        </Link>
        <nav aria-label="Main navigation">
          <Link href="/">The library</Link>
          <Link href="/author">About the author</Link>
          <Link href="/work-with-me">Work with me</Link>
          <Link className="nav-support" href="/support">
            Support the work ↗
          </Link>
        </nav>
      </header>
      <main className="site-main" id="main-content">{children}</main>
      <footer>
        <div className="footer-brand">
          <Link className="goa-logo" href="/" aria-label="GOA Books home">
            GOA<span>.</span>
          </Link>
          <div>
            <strong>{config.author.name}</strong>
            <p>Independent books. Decisive thinking.</p>
          </div>
        </div>
        <nav aria-label="Footer navigation">
          <Link href="/terms">Terms of use</Link>
          <Link href="/privacy">Privacy notice</Link>
          <Link href="/support">Support</Link>
          <Link href="/work-with-me">Work together</Link>
          <Link href="/admin">Publishing desk</Link>
        </nav>
        <small>© {new Date().getFullYear()} {config.author.name}</small>
      </footer>
    </>
  );
}

export function AuthorPanel({ config }: { config: ShopConfig }) {
  return (
    <section className="author-panel">
      <div className="author-photo">
        <Image src={imageSource(config.author.portrait)}
          alt={config.author.name} width={420} height={490}
          sizes="(max-width: 760px) 260px, 400px" />
      </div>
      <div>
        <p className="eyebrow">02 — THE MIND BEHIND THE WORK</p>
        <h2>Experience.<br />On the page.</h2>
        <p className="author-summary">{config.author.bio.split("\n\n")[0]}</p>
        <Link className="text-link" href="/author">
          Meet {config.author.name} ↗
        </Link>
      </div>
    </section>
  );
}

export function Services({ config }: { config: ShopConfig }) {
  return (
    <section className="services">
      <p className="eyebrow">03 — FROM IDEAS TO EXECUTION</p>
      <h2>Need more than<br />a playbook?</h2>
      <p>{config.author.services}</p>
      <Link className="button gold" href="/work-with-me">
        Let&apos;s discuss your campaign ↗
      </Link>
    </section>
  );
}

export function BookPage({ book, config }: { book: Book; config: ShopConfig }) {
  return (
    <Shell config={config}>
      <section className="book-hero">
        <div>
          <Link className="eyebrow back-link" href="/">← BACK TO THE LIBRARY</Link>
          <p className="eyebrow">{book.category} / GOA EDITIONS</p>
          <h1>{book.title}</h1>
          <p className="lead">{book.subtitle}</p>
          <p>{book.description}</p>
          <div className="book-facts">
            <span>{book.pages} pages</span>
            <span>Digital field guide</span>
            <span>By {config.author.name}</span>
          </div>
          <BookActions book={book} settings={config.settings} />
        </div>
        <div className="book-cover-stage">
          <Image className="hero-cover"
            src={imageSource(book.mockup || book.cover)}
            alt={book.title + " book cover"} width={560} height={800}
            sizes="(max-width: 760px) 85vw, 42vw" priority />
          <p>GOA / INDEPENDENT PUBLICATIONS</p>
        </div>
      </section>
      <section className="section">
        <p className="eyebrow">01 — WHAT YOU&apos;LL TAKE AWAY</p>
        <h2>Know more.<br />Move with purpose.</h2>
        <div className="benefits">
          {book.benefits.map((benefit, index) => (
            <article key={benefit}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <p>{benefit}</p>
            </article>
          ))}
        </div>
      </section>
      <section className="excerpt">
        <div>
          <p className="eyebrow">02 — AN EXCERPT</p>
          <h2>From the<br />inside pages.</h2>
        </div>
        <div className="excerpt-copy"><Text value={book.teaser} /></div>
      </section>
      <section className="section">
        <p className="eyebrow">03 — THE CONTENTS</p>
        <h2>Every chapter.<br />A clearer next step.</h2>
        <ol className="chapters">
          {book.chapters.map((chapter) => <li key={chapter}>{chapter}</li>)}
        </ol>
      </section>
      <AuthorPanel config={config} />
      <Services config={config} />
    </Shell>
  );
}
