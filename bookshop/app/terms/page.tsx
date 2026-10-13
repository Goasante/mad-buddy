import { configuration } from "@/lib/shop/store";
import { Shell, Text } from "@/components/public";
export const dynamic = "force-dynamic";
export const metadata = { title: "Terms of use" };
export default async function Page() {
  const { config } = await configuration();
  return (
    <Shell config={config}>
      <section className="section narrow policy">
        <h1>Terms of use</h1>
        <Text value={config.settings.terms} />
      </section>
    </Shell>
  );
}
