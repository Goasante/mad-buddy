import Image from "next/image";
import { brandSymbol } from "@/lib/brand/assets";
import { cn } from "@/lib/utils";

type BrandSymbolProps = {
  className?: string;
  priority?: boolean;
};

/**
 * The Mad Buddy symbol on its own, without the wordmark.
 *
 * WHY THIS EXISTS SEPARATELY FROM BrandMark. BrandMark is the horizontal
 * lockup -- symbol plus wordmark -- so a surface that already prints the name
 * in its own copy would show it twice. This is for those: the auth screens,
 * where the heading reads "Welcome Muddy" right beneath it.
 *
 * Square, so one height/width pair sizes it predictably. Both variants render
 * and CSS picks one, matching BrandMark, so the theme cannot flash the wrong
 * artwork before it resolves.
 */
export function BrandSymbol({ className, priority = false }: BrandSymbolProps) {
  const shared = "shrink-0 object-contain";

  return (
    <>
      <Image
        src={brandSymbol.light.src}
        alt=""
        width={brandSymbol.light.width}
        height={brandSymbol.light.height}
        priority={priority}
        className={cn(shared, "dark:hidden", className)}
        aria-hidden="true"
      />
      <Image
        src={brandSymbol.dark.src}
        alt=""
        width={brandSymbol.dark.width}
        height={brandSymbol.dark.height}
        priority={priority}
        className={cn(shared, "hidden dark:block", className)}
        aria-hidden="true"
      />
    </>
  );
}
