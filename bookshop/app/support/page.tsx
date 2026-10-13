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
      <section className="support-page">
        <div className="support-intro">
          <p className="eyebrow">Independent publishing</p>
          <h1>Support the<br /><em>next edition.</em></h1>
          <p className="lead">Each guide takes research, thought and care.
            If the work has been useful, you can help make the next one possible.</p>
          <p className="support-principle">An optional contribution to future publications.</p>
        </div>
        <div className="support-checkout">
          <p className="eyebrow">Contribute</p>
          <h2>Support the work.</h2>
          <p>Choose a contribution that feels right. Reading a free book never requires a payment.</p>
          {book && <BookActions book={book} settings={config.settings} supportOnly />}
          <p className="fine">Prefer to share instead? Send someone a link to a book they could use.</p>
        </div>
      </section>
    </Shell>
  );
}
