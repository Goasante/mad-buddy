import { configuration } from "@/lib/shop/store";
import { Shell } from "@/components/public";
import { BookActions } from "@/components/reader";
export const dynamic = "force-dynamic";
export const metadata = { title: "Support the next book | Godfred Books" };
export default async function Page() {
  const { config } = await configuration();
  const book = config.books.find((b) => b.published);
  return (
    <Shell config={config}>
      <section className="section narrow">
        <p className="eyebrow">THANK YOU FOR READING</p>
        <h1>
          Help bring
          <br />
          the next guide to life.
        </h1>
        <p className="lead">
          A small contribution helps make more practical books possible. Choose
          an amount that works for you.
        </p>
        {book && (
          <BookActions book={book} settings={config.settings} supportOnly />
        )}
        <p>
          Prefer to support through sharing? Send a colleague the book-page
          link.
        </p>
      </section>
    </Shell>
  );
}
