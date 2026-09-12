/* Through the platform adapter, NOT next/image directly.
   This component is rendered by the shared header, so a direct next/image
   import pulled Next's image runtime into the Capacitor bundle -- verified:
   `_next/image`, `NEXT_DEPLOYMENT_ID` and `imageConfigDefault` were all
   present in mobile/dist. Web still gets the real next/image (the adapter
   re-exports it verbatim), so the optimizer and srcset are unchanged. */
import { Image } from "@/lib/platform";
import { brandLogo } from "@/lib/brand/assets";
import { cn } from "@/lib/utils";

type BrandMarkProps = {
  className?: string;
  priority?: boolean;
};

/**
 * The Mad Buddy logo.
 *
 * BOTH APPROVED VARIANTS ARE RENDERED, and CSS shows the one that suits the
 * background. The alternative -- picking in JS from the theme -- needs the
 * theme resolved before first paint, which means either a flash of the wrong
 * logo or a client-only component. Neither is filtered, inverted or tinted:
 * the pack supplies real light and dark drawings, so the artwork is used as
 * drawn. On web the hidden variant is lazily handled by next/image; on mobile
 * the adapter renders a plain <img> with the same loading hints.
 *
 * Intrinsic ratio is preserved by passing the derivative's real width/height
 * and appending `w-auto` LAST, so twMerge beats any caller's square `w-*` and
 * the wordmark can never be letterboxed into a square box.
 */
export function BrandMark({ className, priority = false }: BrandMarkProps) {
  const shared = "h-9 shrink-0 object-contain";

  return (
    <>
      <Image
        src={brandLogo.light.src}
        alt=""
        width={brandLogo.light.width}
        height={brandLogo.light.height}
        priority={priority}
        className={cn(shared, "dark:hidden", className, "w-auto")}
        aria-hidden="true"
      />
      <Image
        src={brandLogo.dark.src}
        alt=""
        width={brandLogo.dark.width}
        height={brandLogo.dark.height}
        priority={priority}
        className={cn(shared, "hidden dark:block", className, "w-auto")}
        aria-hidden="true"
      />
    </>
  );
}
