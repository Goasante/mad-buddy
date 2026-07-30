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
  previewUrl: string | null;
  onAir: boolean;
  subtitle: string;
};

export function HomeMomentsCarousel({ creators }: { creators: HomeMomentCreator[] }) {
  const { scrollRef, pageCount, activePage, goToPage } = useHorizontalPages(creators.length + 1);

  return (
    <section aria-labelledby="home-moments-heading">
      <div className="mb-2 flex items-center justify-between gap-3 md:mb-3">
        <h2 id="home-moments-heading" className="text-[13px] font-semibold tracking-tight md:text-lg">
          Moments
        </h2>
        <Link
          href="/moments"
          prefetch={false}
          className="focus-ring safe-motion inline-flex min-h-[28px] items-center rounded-full px-2 py-1 text-[10px] font-semibold text-primary hover:bg-primary/10 md:text-sm"
        >
          See all <span aria-hidden="true">›</span>
        </Link>
      </div>

      <div
        ref={scrollRef}
        className="glow-scroll-boundary -mx-1 flex snap-x snap-mandatory gap-1.5 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden md:gap-4"
        aria-label="Active Moments"
      >
        <Link
          href="/moments?create=1"
          prefetch={false}
          className="focus-ring safe-motion flex min-h-[88px] w-[66px] shrink-0 snap-start flex-col items-center gap-1 text-center md:w-[76px] md:gap-2"
          aria-label="Create your Moment"
        >
          <span className="grid h-14 w-14 place-items-center rounded-full border-2 border-dashed border-muted-foreground/60 bg-primary/[0.04] text-primary md:h-16 md:w-16">
            <Plus className="h-4 w-4 md:h-6 md:w-6" aria-hidden="true" />
          </span>
          <span className="line-clamp-2 text-[9px] font-semibold leading-3 md:text-xs md:leading-4">Your Moment</span>
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
            className="focus-ring safe-motion flex min-h-[88px] w-[66px] shrink-0 snap-start flex-col items-center gap-1 text-center md:w-[76px] md:gap-2"
            aria-label={`Open ${creator.name}'s ${creator.onAir ? "Air Moment" : "Moment"}`}
          >
            <span className="relative rounded-full border-2 border-primary p-0.5">
              <UserAvatar
                src={creator.previewUrl ?? creator.avatarUrl}
                name={creator.name}
                size="lg"
                decorative
                className="h-[52px] w-[52px] md:h-[58px] md:w-[58px]"
              />
              {creator.onAir ? (
                <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-red-600 px-1 py-0.5 text-[6px] font-bold leading-none text-white shadow-sm md:px-1.5 md:text-[8px]">
                  <span aria-hidden="true">●</span> ON AIR
                </span>
              ) : null}
            </span>
            <span className="w-full truncate text-[9px] font-semibold md:text-xs">{creator.name}</span>
            <span className={creator.onAir ? "text-[8px] font-semibold text-primary md:text-[10px]" : "text-[8px] text-muted-foreground md:text-[10px]"}>
              {creator.subtitle}
            </span>
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
