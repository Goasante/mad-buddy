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
        <p className="eyebrow">GOA EDITIONS / ACCESS &amp; RECEIPTS</p>
        <h1>Your next chapter<br />starts here.</h1>
        <div className="receipt-panel"><Receipt reference={query.reference} token={query.token} /></div>
      </section>
    </Shell>
  );
}
