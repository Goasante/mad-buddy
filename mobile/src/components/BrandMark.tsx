import { cn } from "@/lib/utils";

// The web BrandMark uses next/image; the SPA serves the same approved variants statically.
export function BrandMark({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex h-9 shrink-0 items-center", className)} aria-hidden="true">
      <img
        src="/brand/mad-buddy-mark-light.png"
        alt=""
        width={128}
        height={128}
        className="h-full w-auto object-contain dark:hidden"
      />
      <img
        src="/brand/mad-buddy-mark-dark.png"
        alt=""
        width={128}
        height={128}
        className="hidden h-full w-auto object-contain dark:block"
      />
    </span>
  );
}
