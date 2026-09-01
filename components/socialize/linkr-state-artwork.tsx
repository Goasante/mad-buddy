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
 * Linkr's supplied state artwork.
 *
 * The PNGs have transparent edges, so the ambient field stays in CSS and
 * follows the active theme. This avoids a pale square on dark mode while the
 * warm orange illustration remains identical in both themes.
 */
export function LinkrStateArtwork({
  variant,
  priority = false,
  className
}: LinkrStateArtworkProps) {
  const artwork = ARTWORK[variant];

  return (
    <div
      className={cn("linkr-state-artwork", className)}
      data-variant={variant}
    >
      <Image
        src={artwork.src}
        alt={artwork.alt}
        width={1254}
        height={1254}
        priority={priority}
        sizes="(max-width: 480px) 88vw, 430px"
        className="relative z-[1] h-auto w-full object-contain"
      />
    </div>
  );
}
