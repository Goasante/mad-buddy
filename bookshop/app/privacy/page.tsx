import { configuration } from "@/lib/shop/store";
import { Shell, Text } from "@/components/public";
export const dynamic = "force-dynamic";
export const metadata = { title: "Privacy notice" };
export default async function Page() {
  const { config } = await configuration();
  return (
    <Shell config={config}>
      <section className="section narrow policy">
        <h1>Privacy notice</h1>
        <Text value={config.settings.privacy} />
      </section>
    </Shell>
  );
}
