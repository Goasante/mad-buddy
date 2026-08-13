import Image from "next/image";
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
 * logo or a client-only component. The alternate image remains lazily handled
 * by Next.js, and neither is filtered, inverted or tinted: the pack supplies
 * real light and dark drawings, so the artwork is used as drawn.
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
