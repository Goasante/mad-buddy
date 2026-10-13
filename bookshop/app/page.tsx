import Link from "next/link";
import Image from "next/image";
import { configuration } from "@/lib/shop/store";
import { Shell, AuthorPanel, Services, imageSource } from "@/components/public";
export const dynamic = "force-dynamic";
export default async function Home() {
  const { config } = await configuration();
  const books = config.books.filter((b) => b.published);
  return (
    <Shell config={config}>
      <section className="library-hero">
        <p className="eyebrow">THE GODFRED COLLECTION</p>
        <h1>
          Read with purpose.
          <br />
          <em>Move with confidence.</em>
        </h1>
        <p>
          Practical books for people who turn research into decisions—and
          decisions into action.
        </p>
        <a className="text-link" href="#books">
          Explore the bookshelf ↓
        </a>
      </section>
      <section className="section" id="books">
        <div className="section-heading">
          <div>
            <p className="eyebrow">THE BOOKSHELF</p>
            <h2>Ideas you can put to work.</h2>
          </div>
          <span>
            {books.length} {books.length === 1 ? "book" : "books"} · More to
            come
          </span>
        </div>
        <div className="book-grid">
          {books.map((b) => (
            <article className="book-card" key={b.id}>
              <Link href={"/books/" + b.slug}>
                <Image
                  src={imageSource(b.cover)}
                  alt={b.title}
                  width={360}
                  height={515}
                />
              </Link>
              <p className="eyebrow">{b.category}</p>
              <h3>
                <Link href={"/books/" + b.slug}>{b.title}</Link>
              </h3>
              <p>{b.subtitle}</p>
              <div className="card-meta">
                {b.mode === "paid"
                  ? "GH₵" + (b.priceMinor / 100).toFixed(2)
                  : "Free PDF"}{" "}
                · {b.pages} pages
              </div>
              <Link className="text-link" href={"/books/" + b.slug}>
                Explore the book ↗
              </Link>
            </article>
          ))}
        </div>
      </section>
      <AuthorPanel config={config} />
      <Services config={config} />
    </Shell>
  );
}
