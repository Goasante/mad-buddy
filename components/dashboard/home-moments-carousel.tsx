"use client";

import Link from "next/link";
import { Plus } from "lucide-react";
import { CarouselDots } from "@/components/ui/carousel-dots";
import { UserAvatar } from "@/components/ui/user-avatar";
import { useHorizontalPages } from "@/hooks/use-horizontal-pages";

export type HomeMomentCreator = {
  authorId: string;
  name: string;
  avatarUrl: string | null;
  onAir: boolean;
};

export function HomeMomentsCarousel({ creators }: { creators: HomeMomentCreator[] }) {
  const { scrollRef, pageCount, activePage, goToPage } = useHorizontalPages(creators.length + 1);

  return (
    <section aria-labelledby="home-moments-heading">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 id="home-moments-heading" className="text-lg font-semibold tracking-tight">
          Moments
        </h2>
        <Link
          href="/moments"
          prefetch={false}
          className="focus-ring safe-motion inline-flex items-center rounded-full px-2 py-1 text-sm font-semibold text-primary hover:bg-primary/10"
        >
          See all <span aria-hidden="true">›</span>
        </Link>
      </div>

      <div
        ref={scrollRef}
        className="glow-scroll-boundary -mx-1 flex snap-x snap-mandatory gap-4 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        aria-label="Active Moments"
      >
        <Link
          href="/moments?create=1"
          prefetch={false}
          className="focus-ring safe-motion flex w-[76px] shrink-0 snap-start flex-col items-center gap-2 text-center"
          aria-label="Create your Moment"
        >
          <span className="grid h-16 w-16 place-items-center rounded-full border-2 border-dashed border-primary/65 bg-primary/[0.06] text-primary">
            <Plus className="h-6 w-6" aria-hidden="true" />
          </span>
          <span className="line-clamp-2 text-xs font-semibold leading-4">Your Moment</span>
        </Link>

        {creators.map((creator) => (
          <Link
            key={`${creator.onAir ? "air" : "private"}-${creator.authorId}`}
            href={
              creator.onAir
                ? `/moments?feed=air&author=${encodeURIComponent(creator.authorId)}`
                : `/moments?author=${encodeURIComponent(creator.authorId)}`
            }
            prefetch={false}
            className="focus-ring safe-motion flex w-[76px] shrink-0 snap-start flex-col items-center gap-2 text-center"
            aria-label={`Open ${creator.name}'s ${creator.onAir ? "Air Moment" : "Moment"}`}
          >
            <span className="relative rounded-full border-2 border-primary p-0.5">
              <UserAvatar
                src={creator.avatarUrl}
                name={creator.name}
                size="lg"
                decorative
                className="h-[58px] w-[58px]"
              />
              {creator.onAir ? (
                <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-red-600 px-1.5 py-0.5 text-[8px] font-bold leading-none text-white shadow-sm">
                  <span aria-hidden="true">●</span> ON AIR
                </span>
              ) : null}
            </span>
            <span className="w-full truncate text-xs font-semibold">{creator.name}</span>
          </Link>
        ))}
      </div>

      <CarouselDots
        count={pageCount}
        active={activePage}
        onSelect={goToPage}
        label="Moments"
      />
    </section>
  );
}
