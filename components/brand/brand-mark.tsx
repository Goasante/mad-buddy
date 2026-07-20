import Image from "next/image";
import { cn } from "@/lib/utils";

type BrandMarkProps = {
  className?: string;
  priority?: boolean;
};

export function BrandMark({ className, priority = false }: BrandMarkProps) {
  return (
    <Image
      src="/brand/mad-buddy-mark-128.png"
      alt=""
      // Intrinsic ratio of the landscape MB mark (634×329). Callers set the
      // height (h-9, h-14, …); w-auto is appended last so twMerge overrides
      // their legacy square w-* and the logo keeps its natural proportions
      // instead of letterboxing inside a square box.
      width={634}
      height={329}
      priority={priority}
      // Default h-9 so a bare <BrandMark /> is sized; callers' h-* win via twMerge.
      className={cn("h-9 shrink-0 object-contain", className, "w-auto")}
      aria-hidden="true"
    />
  );
}
