import Image from "next/image";

import { cn } from "@/lib/utils";

type LinkrStateArtworkProps = {
  variant: "loading" | "opened";
  priority?: boolean;
  className?: string;
};

const ARTWORK = {
  loading: {
    src: "/illustrations/linkr/friendly_city_square_meetup.webp",
    alt: "New people meeting in a city square",
    imageClassName: "object-[50%_39%]"
  },
  opened: {
    src: "/illustrations/linkr/new_connections_in_the_city.webp",
    alt: "Friends connecting in the city",
    imageClassName: "object-[50%_43%]"
  }
} as const;

/**
 * Product-owned Linkr artwork for intro, empty, and discovery-loading states.
 *
 * The supplied illustrations are tall editorial scenes. Linkr presents them as
 * a shallow, content-aware vignette so the art supports the state without
 * pushing the primary action below the first phone viewport. User/profile
 * photos remain completely separate from this component.
 */
export function LinkrStateArtwork({
  variant,
  priority = false,
  className
}: LinkrStateArtworkProps) {
  const artwork = ARTWORK[variant];

  return (
    <div
      className={cn(
        "relative isolate aspect-[16/11] overflow-hidden rounded-[1.75rem] border border-primary/10 bg-card/50 shadow-lg shadow-primary/10 dark:border-white/10 dark:bg-[#111112]/60 dark:shadow-black/30",
        className
      )}
      data-linkr-state-artwork={variant}
    >
      <Image
        src={artwork.src}
        alt={artwork.alt}
        fill
        priority={priority}
        sizes="(max-width: 480px) calc(100vw - 2.5rem), 352px"
        className={cn(
          "object-cover saturate-[0.96] brightness-[0.98] contrast-[0.98] dark:saturate-[0.82] dark:brightness-[0.78] dark:contrast-[0.92]",
          artwork.imageClassName
        )}
      />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-gradient-to-t from-background/35 via-transparent to-background/[0.04] dark:from-[#111112]/45 dark:via-transparent dark:to-[#111112]/10"
      />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 rounded-[inherit] ring-1 ring-inset ring-white/35 dark:ring-white/10"
      />
    </div>
  );
}
