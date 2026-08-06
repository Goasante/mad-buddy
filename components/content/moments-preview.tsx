"use client";

import Link from "next/link";
import { useState } from "react";
import { Camera, Radio, ShieldCheck, Sparkles } from "lucide-react";
import type { VisibleMoment } from "@/lib/content/service";
import { PageSectionHeader } from "@/components/app-shell/page-section-header";
import { MomentTile } from "@/components/content/moment-tile";
import { cn } from "@/lib/utils";

/**
 * Home's Moments preview.
 *
 * A preview only: it renders the same VisibleMoment projection the Moments
 * page uses, and tapping a card opens /moments — the canonical viewer. It
 * does NOT reimplement the feed, reactions, Air, expiry or permissions, and
 * it never fetches on its own; Home passes the already-authorised moments in.
 */
export function MomentsPreview({
  moments,
  air = [],
  hasAirSession = false
}: {
  moments: VisibleMoment[];
  /**
   * Live Air sessions, mixed into the same rail as Moments rather than given
   * their own section. Home shows "the latest authorised content"; the split
   * into Personal / Air belongs to the Moments page.
   */
  air?: VisibleMoment[];
  /**
   * Whether any Air session exists at all. Kept separate from `air` because a
   * caller may know Air is live without loading it (Home used to), and its
   * presence alone means Moments is not genuinely empty.
   */
  hasAirSession?: boolean;
}) {
  // One chronological rail: Moments and Air interleaved by recency, with no
  // section labels. An Air session is just the newest thing a Muddy is doing.
  const items = mixByRecency(moments, air);
  const somethingExists = items.length > 0 || hasAirSession;

  // The educational cards are for the true empty state only: no Moment of the
  // viewer's own, none from any authorised Muddy, and no live Air session.
  // buildMomentFeed already covers the first two (it includes the viewer's own
  // Moments, flagged isAuthor), so an empty feed plus no Air is the full test.
  if (!somethingExists) {
    return (
      <section aria-labelledby="home-moments-heading">
        <PageSectionHeader id="home-moments-heading" title="Moments" />
        <MomentsOnboarding />
      </section>
    );
  }

  // Nothing to show in the rail: render nothing at all rather than a header
  // over an explanation. Home stays quiet; the Moments page is where the state
  // gets described.
  if (items.length === 0) return null;

  return (
    <section aria-labelledby="home-moments-heading">
      <PageSectionHeader id="home-moments-heading" title="Moments" href="/moments" actionLabel="See all" />

      {/* Same rail geometry as Near and Suggestions: bleeds to the screen
          edge, scrolls naturally, no snapping, no indicators, next card
          peeking to signal there is more. */}
      <div className="-mx-4 flex gap-2.5 overflow-x-auto px-4 pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:-mx-6 sm:px-6">
        {items.map((item, index) => (
          <MomentTile
            key={`${item.air ? "air" : "moment"}-${item.moment.id}`}
            moment={item.moment}
            air={item.air}
            priority={index === 0}
          />
        ))}
      </div>
    </section>
  );
}

type RailItem = { moment: VisibleMoment; air: boolean };

/**
 * Interleaves Moments and Air by recency into one rail.
 *
 * Home shows "the latest authorised content" with no section labels, so an
 * Air session simply sits wherever its age puts it — the natural
 * Moment / Moment / AIR / Moment mix the design calls for.
 *
 * The viewer's own Moment is lifted to the front. Both feeds already arrive
 * newest-first from the server, so nothing else is re-ranked, and a Moment
 * appearing in both feeds is rendered once (Air wins, since that is the live
 * surface).
 */
function mixByRecency(moments: VisibleMoment[], air: VisibleMoment[]): RailItem[] {
  const airIds = new Set(air.map((moment) => moment.id));
  const items: RailItem[] = [
    ...air.map((moment) => ({ moment, air: true })),
    // De-duplicated: the same Moment must never occupy two cards.
    ...moments.filter((moment) => !airIds.has(moment.id)).map((moment) => ({ moment, air: false }))
  ];

  return items.sort((a, b) => {
    // Your own Moment leads, whatever its age.
    if (a.moment.isAuthor !== b.moment.isAuthor) return a.moment.isAuthor ? -1 : 1;
    return Date.parse(b.moment.createdAt) - Date.parse(a.moment.createdAt);
  });
}

/**
 * The branded empty experience: four swipeable cards explaining what Moments
 * are, ending in the create action. Shown only when the viewer genuinely has
 * no Moments — once any exist, this never appears again, because the parent
 * renders the rail instead.
 */
const ONBOARDING_CARDS = [
  {
    id: "share",
    icon: Camera,
    title: "Share Moments",
    body: "Post a photo or a thought that disappears after 24 hours.",
    tone: "bg-orange-500/[0.09] dark:bg-orange-400/[0.12]",
    chip: "bg-orange-500/15 text-orange-600 dark:bg-orange-400/20 dark:text-orange-300"
  },
  {
    id: "air",
    icon: Radio,
    title: "Go live with Air",
    body: "Start an Air session and let your circle drop in as it happens.",
    tone: "bg-violet-500/[0.09] dark:bg-violet-400/[0.12]",
    chip: "bg-violet-500/15 text-violet-600 dark:bg-violet-400/20 dark:text-violet-300"
  },
  {
    id: "privacy",
    icon: ShieldCheck,
    title: "Trusted privacy",
    body: "You choose the audience every time. Only Muddies you pick can see it.",
    tone: "bg-emerald-500/[0.09] dark:bg-emerald-400/[0.12]",
    chip: "bg-emerald-500/15 text-emerald-600 dark:bg-emerald-400/20 dark:text-emerald-300"
  },
  {
    id: "create",
    icon: Sparkles,
    title: "Create your first Moment",
    body: "Share something small. It only lasts a day.",
    tone: "bg-pink-500/[0.09] dark:bg-pink-400/[0.12]",
    chip: "bg-pink-500/15 text-pink-600 dark:bg-pink-400/20 dark:text-pink-300",
    cta: "Create a Moment"
  }
] as const;

function MomentsOnboarding() {
  // Tracks which card is centred, purely to light the progress dots. The rail
  // itself is a plain scroller, so it works with no JS and with a keyboard.
  const [active, setActive] = useState(0);

  return (
    <div>
      <div
        className="-mx-4 flex snap-x snap-mandatory gap-2.5 overflow-x-auto px-4 pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:-mx-6 sm:px-6"
        onScroll={(event) => {
          const el = event.currentTarget;
          const card = el.scrollWidth / ONBOARDING_CARDS.length;
          setActive(Math.round(el.scrollLeft / card));
        }}
        aria-label="About Moments"
      >
        {ONBOARDING_CARDS.map((card) => {
          const Icon = card.icon;
          return (
            <div
              key={card.id}
              className={cn(
                "flex w-[13.5rem] shrink-0 snap-start flex-col rounded-[1.25rem] border border-black/[0.04] p-4 dark:border-white/[0.06]",
                card.tone
              )}
            >
              <span className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-[0.7rem]", card.chip)}>
                <Icon className="h-[19px] w-[19px]" strokeWidth={1.75} aria-hidden="true" />
              </span>
              <p className="mt-3 text-[0.875rem] font-semibold leading-tight">{card.title}</p>
              <p className="mt-1.5 flex-1 text-[0.78125rem] leading-[1.4] text-muted-foreground">{card.body}</p>
              {"cta" in card ? (
                <Link
                  href="/moments"
                  className="focus-ring mt-3 inline-flex items-center self-start rounded-full bg-primary px-3 py-1.5 text-[0.75rem] font-semibold text-primary-foreground"
                >
                  {card.cta}
                </Link>
              ) : null}
            </div>
          );
        })}
      </div>

      {/* Progress dots. Decorative — the cards are already reachable by
          scrolling and by keyboard, so this is not a control. */}
      <div className="mt-2.5 flex justify-center gap-1.5" aria-hidden="true">
        {ONBOARDING_CARDS.map((card, index) => (
          <span
            key={card.id}
            className={cn(
              "h-1.5 rounded-full transition-all duration-200 motion-reduce:transition-none",
              index === active ? "w-4 bg-primary" : "w-1.5 bg-border"
            )}
          />
        ))}
      </div>
    </div>
  );
}
