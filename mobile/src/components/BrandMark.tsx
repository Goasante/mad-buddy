import { cn } from "@/lib/utils";

// The web BrandMark uses next/image; the SPA serves the same asset statically.
export function BrandMark({ className }: { className?: string }) {
  return (
    <img
      src="/brand/mad-buddy-mark-128.png"
      alt=""
      width={634}
      height={329}
      className={cn("h-9 shrink-0 object-contain", className, "w-auto")}
      aria-hidden="true"
    />
  );
}
