import { configuration } from "@/lib/shop/store";
import { Shell } from "@/components/public";
import Receipt from "@/components/receipt";
export const dynamic = "force-dynamic";
export const metadata = {
  title: "Your receipt",
  robots: { index: false, follow: false },
};
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ reference?: string; token?: string }>;
}) {
  const { config } = await configuration();
  const query = await searchParams;
  return (
    <Shell config={config}>
      <section className="section narrow receipt-page">
        <p className="eyebrow">Your bookshop receipt</p>
        <h1>Your receipt &amp; access.</h1>
        <div className="receipt-panel"><Receipt reference={query.reference} token={query.token} /></div>
      </section>
    </Shell>
  );
}
