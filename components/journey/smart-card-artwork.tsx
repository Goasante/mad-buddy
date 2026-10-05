import type { SmartCard } from "@/lib/smart-card/smart-card";
import { smartCardArtwork } from "@/lib/smart-card/artwork";

export function SmartCardArtwork({ card }: { card: Pick<SmartCard, "id" | "eyebrow"> }) {
  const artwork = smartCardArtwork(card);
  return (
    <svg
      viewBox={artwork.viewBox}
      aria-hidden="true"
      focusable="false"
      data-smart-card-scene={artwork.scene}
      className="block h-full w-full overflow-hidden rounded-2xl"
      preserveAspectRatio="xMidYMid meet"
    >
      <image href={artwork.src} width="1024" height="1024" />
    </svg>
  );
}
