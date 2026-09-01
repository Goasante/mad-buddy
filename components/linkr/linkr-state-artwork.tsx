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
 * The supplied PNGs keep transparent outer edges. The artwork is intentionally
 * softened here so it belongs to the Linkr surface instead of reading like a
 * bright sticker sitting above Warm Paper or the near-black dark canvas.
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
        className="pointer-events-none absolute inset-[18%] z-0 rounded-full bg-primary/[0.055] blur-[2.25rem] dark:bg-primary/[0.07]"
      />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-[26%] z-0 rounded-full bg-card/[0.38] blur-[1.75rem] dark:bg-[#111112]/[0.34]"
      />
      <Image
        src={artwork.src}
        alt={artwork.alt}
        width={1254}
        height={1254}
        priority={priority}
        sizes="(max-width: 480px) 88vw, 430px"
        className="relative z-[1] h-auto w-full object-contain opacity-[0.76] saturate-[0.8] brightness-[0.94] contrast-[0.9] drop-shadow-sm dark:opacity-[0.72] dark:saturate-[0.74] dark:brightness-[0.82] dark:contrast-[0.88] dark:drop-shadow-md"
      />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -inset-px z-[2] dark:hidden"
        style={{
          background:
            "linear-gradient(to bottom, hsl(var(--background) / 0.08) 0%, transparent 34%, hsl(var(--background) / 0.56) 100%), radial-gradient(circle at 50% 48%, transparent 44%, hsl(var(--background) / 0.64) 100%)"
        }}
      />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -inset-px z-[2] hidden dark:block"
        style={{
          background:
            "linear-gradient(to bottom, rgb(17 17 18 / 0.1) 0%, transparent 32%, rgb(17 17 18 / 0.62) 100%), radial-gradient(circle at 50% 48%, transparent 40%, rgb(17 17 18 / 0.72) 100%)"
        }}
      />
    </div>
  );
}
