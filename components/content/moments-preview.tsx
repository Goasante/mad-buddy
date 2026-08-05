"use client";

import Link from "next/link";
import { useState } from "react";
import { Camera, Radio, ShieldCheck, Sparkles } from "lucide-react";
import type { VisibleMoment } from "@/lib/content/service";
import { MomentImage } from "@/components/ui/moment-image";
import { PageSectionHeader } from "@/components/app-shell/page-section-header";
import { cn, formatRelativeTime } from "@/lib/utils";

/**
 * Home's Moments preview.
 *
 * A preview only: it renders the same VisibleMoment projection the Moments
 * page uses, and tapping a card opens /moments — the canonical viewer. It
 * does NOT reimplement the feed, reactions, Air, expiry or permissions, and
 * it never fetches on its own; Home passes the already-authorised moments in.
 */
export function MomentsPreview({ moments }: { moments: VisibleMoment[] }) {
  if (moments.length === 0) {
    return (
      <section aria-labelledby="home-moments-heading">
        <PageSectionHeader id="home-moments-heading" title="Moments" />
        <MomentsOnboarding />
      </section>
    );
  }

  return (
    <section aria-labelledby="home-moments-heading">
      <PageSectionHeader id="home-moments-heading" title="Moments" href="/moments" actionLabel="See all" />

      {/* Same rail geometry as Near and Suggestions: bleeds to the screen
          edge, scrolls naturally, no snapping, no indicators, next card
          peeking to signal there is more. */}
      <div className="-mx-4 flex gap-2.5 overflow-x-auto px-4 pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:-mx-6 sm:px-6">
        {moments.map((moment, index) => (
          <MomentPreviewCard key={moment.id} moment={moment} priority={index === 0} />
        ))}
      </div>
    </section>
  );
}

/**
 * One Moment. The image is the hero: no badges, no borders, no chrome — just
 * a dark bottom gradient so the creator name and age stay readable over any
 * photo.
 */
function MomentPreviewCard({ moment, priority }: { moment: VisibleMoment; priority: boolean }) {
  const fullName = moment.authorName.trim() || "A Muddy";
  // First name only, as in the Near rail: at this card width a full name
  // ellipsises on most people, and the screen-reader label below keeps the
  // complete name available.
  const name = fullName.split(/\s+/)[0] ?? fullName;
  const age = formatRelativeTime(moment.createdAt);

  return (
    <Link
      href="/moments"
      // There is no per-Moment deep link in the app; /moments is the canonical
      // viewer, and inventing a route here would be a second Moments system.
      aria-label={`Moment from ${fullName}, ${age}`}
      className="focus-ring safe-motion relative block aspect-[3/4] w-[7.75rem] shrink-0 overflow-hidden rounded-[1.25rem] bg-secondary shadow-[0_1px_3px_hsl(var(--shadow)/0.08)] transition-transform active:scale-[0.98] motion-reduce:active:scale-100"
    >
      {moment.contentType === "text" ? (
        // A text Moment has no media; show its words rather than an empty box.
        // Bottom padding keeps the text clear of the name/age block below it,
        // and the clamp is tighter than a full card because that block eats
        // roughly a quarter of the height.
        <span className="absolute inset-0 grid place-items-center bg-gradient-to-br from-primary/25 to-primary/5 px-3 pb-11 pt-3">
          <span className="line-clamp-3 text-center text-[0.8125rem] font-medium leading-snug">
            {moment.textContent}
          </span>
        </span>
      ) : (
        // Reuses the canonical image component: lazy by default, one retry on a
        // stale signed URL, graceful fallback. Only the first card is eager.
        <MomentImage
          src={moment.mediaUrl}
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
          fallbackClassName="absolute inset-0"
          priority={priority}
        />
      )}

      {/* Readability scrim. Sized to the text block so it darkens the caption
          area without dimming the photo itself. */}
      <span
        className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/75 via-black/35 to-transparent"
        aria-hidden="true"
      />

      <span className="absolute inset-x-0 bottom-0 p-2.5" aria-hidden="true">
        <span className="block truncate text-[0.8125rem] font-semibold leading-tight text-white">{name}</span>
        <span className="mt-0.5 block text-[0.6875rem] leading-tight text-white/75">{age}</span>
      </span>
    </Link>
  );
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
