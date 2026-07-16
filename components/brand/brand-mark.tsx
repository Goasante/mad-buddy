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
      width={128}
      height={128}
      priority={priority}
      className={cn("shrink-0 object-contain", className)}
      aria-hidden="true"
    />
  );
}
