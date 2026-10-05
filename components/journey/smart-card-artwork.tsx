import Image from "next/image";
import type { SmartCard } from "@/lib/smart-card/smart-card";
import { smartCardArtwork } from "@/lib/smart-card/artwork";

export function SmartCardArtwork({ card }: { card: Pick<SmartCard, "id" | "eyebrow"> }) {
  const artwork = smartCardArtwork(card);
  return (
    <Image
      src={artwork.src}
      alt=""
      width={720}
      height={540}
      sizes="(min-width: 640px) 256px, 144px"
      unoptimized
      aria-hidden="true"
      data-smart-card-scene={artwork.scene}
      className="block h-full w-full object-contain"
    />
  );
}
