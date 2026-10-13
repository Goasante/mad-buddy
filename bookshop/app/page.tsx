import Link from "next/link";
import Image from "next/image";
import { configuration } from "@/lib/shop/store";
import { Shell, AuthorPanel, Services, imageSource } from "@/components/public";

export const dynamic = "force-dynamic";

export default async function Home() {
  const { config } = await configuration();
  const books = config.books.filter((book) => book.published);
  const featured = books[0];

  return (
    <Shell config={config}>
      <section className="library-hero" aria-labelledby="library-title">
        <div className="hero-copy">
          <p className="eyebrow">GOA / THE INDEPENDENT LIBRARY</p>
          <h1 id="library-title">
            Knowledge<br />with <em>intent.</em>
          </h1>
          <p>
            Clear thinking for decisive people. Practical field guides built
            to turn good research into confident action.
          </p>
          <div className="hero-actions">
            <a className="button gold" href="#books">
              Explore the collection ↗
            </a>
            <Link className="text-link" href="/author">
              Behind the books ↗
            </Link>
          </div>
        </div>
        {featured && (
          <Link className="hero-feature" href={"/books/" + featured.slug}
            aria-label={"Explore " + featured.title}>
            <figure>
              <div className="hero-feature-visual">
                <span className="hero-edition">FEATURED / 001</span>
                <Image src={imageSource(featured.cover)}
                  alt={featured.title + " book cover"}
                  width={360} height={500} priority
                  sizes="(max-width: 760px) 75vw, 30vw" />
              </div>
              <figcaption>
                <span>{featured.category}</span>
                <span>Discover the guide ↗</span>
              </figcaption>
            </figure>
          </Link>
        )}
      </section>
      <div className="principle-strip" aria-label="What you'll find here">
        <span>01 / Research <i>↗</i></span>
        <span>02 / Clarity <i>↗</i></span>
        <span>03 / Execution <i>↗</i></span>
        <span>By Godfred Ofosu Asante</span>
      </div>
      <section className="section" id="books" aria-labelledby="books-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">01 — THE COLLECTION</p>
            <h2 id="books-title">Ideas worth<br />putting to work.</h2>
          </div>
          <span>
            {books.length} {books.length === 1 ? "publication" : "publications"}
            {" "} / Independently published
          </span>
        </div>
        <div className="book-grid">
          {books.map((book) => (
            <article className="book-card" key={book.id}>
              <Link className="book-visual" href={"/books/" + book.slug}>
                <Image src={imageSource(book.cover)}
                  alt={book.title + " cover"} width={360} height={515}
                  sizes="(max-width: 760px) 80vw, 340px" />
              </Link>
              <p className="eyebrow">{book.category}</p>
              <h3><Link href={"/books/" + book.slug}>{book.title}</Link></h3>
              <p>{book.subtitle}</p>
              <div className="card-meta">
                {book.mode === "paid" ? "GH₵" + (book.priceMinor / 100).toFixed(2) : "Free to read"}
                {" "} · {book.pages} pages
              </div>
              <Link className="text-link" href={"/books/" + book.slug}>
                Explore this book ↗
              </Link>
            </article>
          ))}
        </div>
      </section>
      <aside className="editorial-note">
        <p className="eyebrow">A NOTE FROM THE AUTHOR</p>
        <p>Less noise. Better questions. Stronger decisions. That is the work behind every edition.</p>
      </aside>
      <AuthorPanel config={config} />
      <Services config={config} />
    </Shell>
  );
}
