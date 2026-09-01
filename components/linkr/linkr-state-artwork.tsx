import Image from "next/image";

import { cn } from "@/lib/utils";

type LinkrStateArtworkProps = {
  variant: "loading" | "opened";
  priority?: boolean;
  className?: string;
};

const ARTWORK = {
  loading: {
    src: "/illustrations/linkr/linkr-loading.png",
    alt: "Three people connected through Linkr"
  },
  opened: {
    src: "/illustrations/linkr/linkr-opened.png",
    alt: "Two people connected through Linkr"
  }
} as const;

/**
 * The approved Linkr state artwork.
 *
 * The supplied PNGs keep transparent outer edges, so the illustration itself
 * stays crisp while these two soft, theme-owned halos keep it from reading as
 * a pasted square on either Warm Paper or the near-black dark canvas.
 */
export function LinkrStateArtwork({
  variant,
  priority = false,
  className
}: LinkrStateArtworkProps) {
  const artwork = ARTWORK[variant];

  return (
    <div
      className={cn("linkr-state-artwork relative isolate", className)}
      data-linkr-state-artwork={variant}
    >
      <span
        aria-hidden="true"
        className="linkr-state-artwork__ambient linkr-state-artwork__ambient--outer"
      />
      <span
        aria-hidden="true"
        className="linkr-state-artwork__ambient linkr-state-artwork__ambient--inner"
      />
      <Image
        src={artwork.src}
        alt={artwork.alt}
        width={1254}
        height={1254}
        priority={priority}
        sizes="(max-width: 480px) 88vw, 430px"
        className="linkr-state-artwork__image relative z-[1] h-auto w-full object-contain"
      />
      <span aria-hidden="true" className="linkr-state-artwork__veil" />
    </div>
  );
}
