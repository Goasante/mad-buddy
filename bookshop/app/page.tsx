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
          <p className="eyebrow">Independent books by Godfred Ofosu Asante</p>
          <h1 id="library-title">For your next<br /><em>big move.</em></h1>
          <p>Practical guides for founders, business buyers and the people who build their next opportunity.</p>
          <div className="hero-actions">
            <a className="button gold" href="#books">Explore the books</a>
            <Link className="text-link" href="/work-with-me">Work with Godfred</Link>
          </div>
          <p className="hero-signature">Research. Relationships. Enterprise.</p>
        </div>
        {featured && (
          <Link className="hero-feature" href={"/books/" + featured.slug} aria-label={"Explore " + featured.title}>
            <figure>
              <div className="hero-feature-visual">
                <Image src={imageSource(featured.mockup || featured.cover)} alt={featured.title + " book"} width={1049} height={1500} priority sizes="(max-width: 760px) 80vw, 420px" />
              </div>
              <figcaption><span>Featured publication</span><span>{featured.title}</span></figcaption>
            </figure>
          </Link>
        )}
      </section>
      <section className="section collection" id="books" aria-labelledby="books-title">
        <div className="section-heading">
          <div><p className="eyebrow">The collection</p><h2 id="books-title">A considered advantage.</h2></div>
          <p>Field guides with a clear purpose.<br />Built to be used, chapter by chapter.</p>
        </div>
        <div className="book-grid">
          {books.map((book) => (
            <article className="book-card" key={book.id}>
              <Link className="book-visual" href={"/books/" + book.slug} aria-label={"Explore " + book.title}>
                <Image src={imageSource(book.mockup || book.cover)} alt={book.title + " book"} width={1049} height={1500} sizes="(max-width: 760px) 65vw, 280px" />
              </Link>
              <div className="book-card-copy">
                <p className="eyebrow">{book.category}</p>
                <h3><Link href={"/books/" + book.slug}>{book.title}</Link></h3>
                <p>{book.description}</p>
                <div className="card-meta"><span>{book.pages} pages · Digital edition</span><span>{book.mode === "paid" ? "GH₵" + (book.priceMinor / 100).toFixed(2) : "Complimentary PDF"}</span></div>
                <Link className="button gold" href={"/books/" + book.slug}>Discover the book</Link>
              </div>
            </article>
          ))}
          {books.length === 0 && <p>New publications are being prepared. Check back for the next edition.</p>}
        </div>
      </section>
      <AuthorPanel config={config} />
      <Services config={config} />
    </Shell>
  );
}
