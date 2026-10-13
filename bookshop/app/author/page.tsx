import Image from "next/image";
import Link from "next/link";
import { configuration } from "@/lib/shop/store";
import { Shell, Text, Services, imageSource } from "@/components/public";
export const dynamic = "force-dynamic";
export const metadata = { title: "The author | Godfred Ofosu Asante" };
export default async function Page() {
  const { config } = await configuration();
  return (
    <Shell config={config}>
      <section className="author-hero">
        <div>
          <p className="eyebrow">RESEARCH. JUDGMENT. EXECUTION.</p>
          <h1>{config.author.name}</h1>
          <Text value={config.author.bio} />
          <p className="author-mantra">
            Know what you want. Know whom you’re approaching. Make the
            conversation count.
          </p>
          <div className="action-row">
            <Link className="text-link" href={config.author.linkedin}>
              LinkedIn ↗
            </Link>
            <Link className="text-link" href={config.author.portfolio}>
              Portfolio ↗
            </Link>
          </div>
        </div>
        <Image
          src={imageSource(config.author.portrait)}
          alt={config.author.name}
          width={450}
          height={540}
        />
      </section>
      <Services config={config} />
    </Shell>
  );
}
