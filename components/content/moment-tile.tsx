"use client";

import type { Route } from "next";
import Link from "next/link";
import { Eye } from "lucide-react";
import type { VisibleMoment } from "@/lib/content/service";
import { MomentImage } from "@/components/ui/moment-image";
import { UserAvatar } from "@/components/ui/user-avatar";
import { momentHref } from "@/lib/content/moment-target";
import { cn, formatRelativeTime } from "@/lib/utils";

/**
 * THE Moment card. One component for every surface — the Home rail and all
 * three tabs of the Moments page — so a Moment looks the same wherever it
 * appears and there is no second card implementation to keep in step.
 *
 * Renders the canonical VisibleMoment projection and nothing else: it never
 * fetches, never mutates, and tapping it opens the existing viewer.
 */
export function MomentTile({
  moment,
  /** Air sessions get the AIR badge and open the Air surface. */
  air = false,
  priority = false,
  className
}: {
  moment: VisibleMoment;
  air?: boolean;
  priority?: boolean;
  className?: string;
}) {
  const fullName = moment.authorName.trim() || "A Muddy";
  // First name only: the card is ~9rem wide and a full name ellipsises on most
  // people. The complete name stays in the accessible label below.
  const name = fullName.split(/\s+/)[0] ?? fullName;
  const age = formatRelativeTime(moment.createdAt);
  const relationship = relationshipLabel(moment.viewerRelationship);
  const caption = (moment.caption ?? moment.textContent ?? "").trim();

  return (
    <Link
      // The EXACT Moment, not just its tab: tapping a card opens the card
      // it shows, wherever that card appears.
      href={momentHref(moment.id, air ? "air" : "moments") as Route}
      aria-label={[
        air ? `Air session from ${fullName}` : `Moment from ${fullName}`,
        relationship,
        age,
        caption || null,
        moment.viewCount === null ? null : `${moment.viewCount} views`
      ]
        .filter(Boolean)
        .join(", ")}
      className={cn(
        "focus-ring safe-motion relative flex aspect-[3/4] w-[9rem] shrink-0 flex-col overflow-hidden rounded-[1.25rem] bg-secondary shadow-[0_1px_3px_hsl(var(--shadow)/0.08)] transition-transform active:scale-[0.98] motion-reduce:active:scale-100",
        className
      )}
    >
      {caption && moment.contentType === "text" ? (
        <span className="absolute inset-0 bg-gradient-to-br from-primary/25 to-primary/5" aria-hidden="true" />
      ) : (
        <MomentImage
          src={moment.mediaUrl}
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
          fallbackClassName="absolute inset-0"
          priority={priority}
        />
      )}

      {/* Top and bottom scrims, so the overlaid text stays readable on any
          photo without dimming the middle of the image. */}
      <span
        className="pointer-events-none absolute inset-x-0 top-0 h-2/5 bg-gradient-to-b from-black/70 to-transparent"
        aria-hidden="true"
      />
      <span
        className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/80 via-black/40 to-transparent"
        aria-hidden="true"
      />

      {/* Creator row */}
      <span className="relative flex items-start gap-1.5 p-2" aria-hidden="true">
        <UserAvatar
          src={moment.authorAvatarUrl}
          name={fullName}
          size="xs"
          decorative
          className="shrink-0 ring-2 ring-[var(--color-brand-orange)]"
        />
        <span className="min-w-0 flex-1 pt-px">
          <span className="block truncate text-[0.6875rem] font-semibold leading-tight text-white">{name}</span>
          {relationship ? (
            <span className="block truncate text-[0.5625rem] leading-tight text-white/70">{relationship}</span>
          ) : null}
        </span>
        <span className="shrink-0 text-[0.5625rem] font-medium leading-tight text-white/80">{age}</span>
      </span>

      {/* AIR badge. Deliberately the product name — the word "LIVE" is never
          used anywhere in Mad Buddy. */}
      {air ? (
        <span
          className="absolute left-2 top-11 inline-flex items-center gap-1 rounded-full bg-[var(--color-brand-orange)] px-1.5 py-0.5 text-[0.5625rem] font-bold uppercase tracking-wide text-white"
          aria-hidden="true"
        >
          <span className="h-1 w-1 rounded-full bg-white" />
          Air
        </span>
      ) : null}

      {/* Caption + reach */}
      <span className="relative mt-auto p-2" aria-hidden="true">
        {caption ? (
          <span className="mb-1 line-clamp-2 block text-[0.6875rem] font-medium leading-snug text-white">
            {caption}
          </span>
        ) : null}
        {moment.viewCount === null ? null : (
          <span className="inline-flex items-center gap-1 text-[0.5625rem] font-medium text-white/80">
            <Eye className="h-2.5 w-2.5" strokeWidth={2} />
            {moment.viewCount}
          </span>
        )}
      </span>
    </Link>
  );
}

/** Product wording for the viewer's relationship to the creator. */
export function relationshipLabel(
  relationship: VisibleMoment["viewerRelationship"]
): string | null {
  switch (relationship) {
    case "self":
      return "You";
    case "close_friend":
      return "Close Friend";
    case "muddy":
      return "Trusted Buddy";
    default:
      return null;
  }
}
