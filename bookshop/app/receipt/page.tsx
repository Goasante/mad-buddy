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
      <section className="section narrow">
        <p className="eyebrow">YOUR NEXT MOVE</p>
        <h1>Thank you.</h1>
        <Receipt reference={query.reference} token={query.token} />
      </section>
    </Shell>
  );
}
