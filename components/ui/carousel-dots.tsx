"use client";

import { cn } from "@/lib/utils";

export function CarouselDots({
  count,
  active,
  onSelect,
  label
}: {
  count: number;
  active: number;
  onSelect: (page: number) => void;
  label: string;
}) {
  if (count <= 1) return null;

  return (
    <div className="mt-1.5 flex justify-center gap-1 md:mt-3 md:gap-1.5" role="group" aria-label={`${label} pages`}>
      {Array.from({ length: count }, (_, page) => (
        <button
          key={page}
          type="button"
          onClick={() => onSelect(page)}
          aria-label={`Show ${label} page ${page + 1}`}
          aria-current={page === active ? "true" : undefined}
          className={cn(
            "focus-ring safe-motion h-1.5 min-h-1.5 rounded-full md:h-2 md:min-h-2",
            page === active ? "w-4 bg-primary md:w-5" : "w-1.5 bg-muted-foreground/35 hover:bg-muted-foreground/60 md:w-2"
          )}
        />
      ))}
    </div>
  );
}
