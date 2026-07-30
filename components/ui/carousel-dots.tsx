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
    <div className="mt-3 flex justify-center gap-1.5" role="group" aria-label={`${label} pages`}>
      {Array.from({ length: count }, (_, page) => (
        <button
          key={page}
          type="button"
          onClick={() => onSelect(page)}
          aria-label={`Show ${label} page ${page + 1}`}
          aria-current={page === active ? "true" : undefined}
          className={cn(
            "focus-ring safe-motion h-2 min-h-2 rounded-full",
            page === active ? "w-5 bg-primary" : "w-2 bg-muted-foreground/35 hover:bg-muted-foreground/60"
          )}
        />
      ))}
    </div>
  );
}
