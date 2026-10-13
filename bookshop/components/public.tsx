import Link from "next/link";
import Image from "next/image";
import type { Book, ShopConfig } from "@/lib/shop/schema";
import { BookActions } from "./reader";
export const imageSource = (value: string) =>
  value.startsWith("asset:") ? "/api/assets/" + value.slice(6) : value;
export function Text({ value }: { value: string }) {
  return (
    <>
      {value.split("\n\n").map((p, i) => (
        <p key={i}>{p}</p>
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
      <header className="header">
        <Link className="wordmark" href="/">
          GODFRED<span>BOOKS & FIELD GUIDES</span>
        </Link>
        <nav aria-label="Main navigation">
          <Link href="/">Books</Link>
          <Link href="/author">The author</Link>
          <Link href="/work-with-me">Work with me</Link>
          <Link className="nav-support" href="/support">
            Support the next book ↗
          </Link>
        </nav>
      </header>
      <main>{children}</main>
      <footer>
        <div>
          <strong>{config.author.name}</strong>
          <p>Clear thinking. Practical execution.</p>
        </div>
        <nav aria-label="Footer">
          <Link href="/terms">Terms of use</Link>
          <Link href="/privacy">Privacy notice</Link>
          <Link href="/support">Support</Link>
          <Link href="/admin">Admin</Link>
        </nav>
        <small>
          © {new Date().getFullYear()} {config.author.name}
        </small>
      </footer>
    </>
  );
}
export function AuthorPanel({ config }: { config: ShopConfig }) {
  return (
    <section className="author-panel">
      <Image
        src={imageSource(config.author.portrait)}
        alt={config.author.name}
        width={200}
        height={240}
      />
      <div>
        <p className="eyebrow">THE AUTHOR</p>
        <h2>{config.author.name}</h2>
        <p>{config.author.bio.split("\n\n")[0]}</p>
        <Link className="text-link" href="/author">
          Meet the author ↗
        </Link>
      </div>
    </section>
  );
}
export function Services({ config }: { config: ShopConfig }) {
  return (
    <section className="services">
      <p className="eyebrow">RESEARCH. OUTREACH. FOLLOW-THROUGH.</p>
      <h2>Put the playbook to work.</h2>
      <p>{config.author.services}</p>
      <Link className="button gold" href="/work-with-me">
        Discuss your campaign ↗
      </Link>
    </section>
  );
}
export function BookPage({ book, config }: { book: Book; config: ShopConfig }) {
  return (
    <Shell config={config}>
      <section className="book-hero">
        <div>
          <Link className="eyebrow" href="/">
            ← THE BOOKSHELF
          </Link>
          <p className="eyebrow">{book.category}</p>
          <h1>{book.title}</h1>
          <p className="lead">{book.subtitle}</p>
          <p>{book.description}</p>
          <div className="book-facts">
            <span>{book.pages} pages</span>
            <span>PDF field guide</span>
            <span>By {config.author.name}</span>
          </div>
          <BookActions book={book} settings={config.settings} />
        </div>
        <Image
          className="hero-cover"
          src={imageSource(book.mockup || book.cover)}
          alt={book.title + " cover"}
          width={560}
          height={800}
          priority
        />
      </section>
      <section className="section">
        <p className="eyebrow">THE ADVANTAGE IS IN THE PREPARATION</p>
        <h2>Build a pipeline you can explain.</h2>
        <div className="benefits">
          {book.benefits.map((b, i) => (
            <article key={b}>
              <span>0{i + 1}</span>
              <p>{b}</p>
            </article>
          ))}
        </div>
      </section>
      <section className="excerpt">
        <div>
          <p className="eyebrow">A TASTE OF THE BOOK</p>
          <h2>Access is earned.</h2>
        </div>
        <div className="excerpt-copy">
          <Text value={book.teaser} />
        </div>
      </section>
      <section className="section">
        <p className="eyebrow">INSIDE THE GUIDE</p>
        <h2>From mandate to meaningful conversations.</h2>
        <ol className="chapters">
          {book.chapters.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ol>
      </section>
      <AuthorPanel config={config} />
      <Services config={config} />
    </Shell>
  );
}
