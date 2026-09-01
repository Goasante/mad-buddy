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
      className={cn("relative isolate", className)}
      data-linkr-state-artwork={variant}
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-[14%] rounded-full bg-primary/10 blur-3xl dark:bg-primary/15"
      />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-[24%] rounded-full bg-card/80 blur-3xl dark:bg-white/[0.04]"
      />
      <Image
        src={artwork.src}
        alt={artwork.alt}
        width={1254}
        height={1254}
        priority={priority}
        sizes="(max-width: 480px) 88vw, 430px"
        className="relative z-[1] h-auto w-full object-contain drop-shadow-lg dark:drop-shadow-2xl"
      />
    </div>
  );
}
