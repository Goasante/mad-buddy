"use client";

import type { Route } from "next";
import Link from "next/link";
import { Check, MapPin, Users } from "lucide-react";
import { memo, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { UserAvatar } from "@/components/ui/user-avatar";
import { resolvePlanCover } from "@/lib/plans/plan-covers";
import {
  planDateParts,
  planGoingLabel,
  planJoinState,
  planTimeLabel,
  planUrgency
} from "@/lib/plans/discovery";
import type { HomeUpcomingPlan } from "@/lib/social/upcoming-plans";
import { cn } from "@/lib/utils";

/**
 * One plan in Socialize discovery.
 *
 * The widest card in the rail on purpose. A plan is the one thing here with a
 * deadline, and a card you can only half-read does not create the feeling of
 * not wanting to miss something — so this sits at roughly 1.3 cards per
 * viewport rather than the three used for people and groups.
 *
 * Every field is real: cover, title, date, time, place, host, going count and
 * RSVP all come from the existing projection. Nothing manufactures scarcity —
 * there is no "Almost full", no countdown, and no attendance number invented
 * to make a quiet plan look busy.
 *
 * Memoised, like the other discovery cards: the rail re-renders on every
 * filter and search keystroke.
 */

export type SocializePlanCardProps = {
  plan: HomeUpcomingPlan;
  onJoin: (plan: HomeUpcomingPlan) => void;
  pending?: boolean;
  /** Future slot. Rendered only when a caller passes real content. */
  slots?: { afterMeta?: ReactNode };
};

function PlanCard({ plan, onJoin, pending = false, slots }: SocializePlanCardProps) {
  const href = `/plans?plan=${plan.id}` as Route;
  // The canonical resolver: uploaded image, else per-category art, else the
  // branded fallback. Never a grey box, and never a second cover system.
  const cover = resolvePlanCover(plan);
  const urgency = planUrgency(plan.startAt);
  const date = planDateParts(plan.startAt);
  const time = planTimeLabel(plan.startAt);
  const going = planGoingLabel(plan.goingCount);
  const join = planJoinState(plan);

  return (
    <article
      aria-label={`${plan.title}${urgency.label ? `, ${urgency.label}` : ""}${time ? ` at ${time}` : ""}`}
      className={cn(
        "linkr-card group relative flex h-full flex-col overflow-hidden",
        // The nearest plan carries a slightly warmer edge. One card lifted,
        // never a row of competing highlights.
        urgency.imminent && "shadow-[0_0_0_1px_hsl(var(--primary)/0.25),0_16px_44px_-18px_hsl(var(--primary)/0.55)]"
      )}
    >
      <Link
        href={href}
        aria-label={`Open ${plan.title}`}
        className="focus-ring relative block aspect-[5/3] w-full overflow-hidden"
      >
        {cover.source === "upload" ? (
          // eslint-disable-next-line @next/next/no-img-element -- signed cover URL, not a static asset
          <img
            src={cover.imageUrl}
            alt=""
            loading="lazy"
            decoding="async"
            className="linkr-card-media h-full w-full object-cover"
          />
        ) : (
          <span
            aria-hidden="true"
            className="linkr-card-media absolute inset-0"
            style={{ background: `linear-gradient(135deg, ${cover.art.from}, ${cover.art.to})` }}
          />
        )}

        {/* THE DATE, as an object rather than a line of text. It is the first
            thing worth knowing about a plan, so it gets weight and a surface
            of its own instead of sitting in a metadata row. */}
        {date ? (
          <span className="pointer-events-none absolute left-3 top-3 grid w-[3.25rem] place-items-center gap-0.5 rounded-2xl border border-white/15 bg-background/92 py-2 text-center shadow-[0_8px_22px_-12px_hsl(var(--shadow)/0.7)] backdrop-blur-md">
            <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-primary">
              {date.weekday}
            </span>
            <span className="text-[1.375rem] font-bold leading-none tracking-tight">{date.day}</span>
            <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              {date.month}
            </span>
          </span>
        ) : null}

        {/* Urgency, only when it is real. Absent for anything beyond a week. */}
        {urgency.label ? (
          <span
            className={cn(
              "pointer-events-none absolute right-3 top-3 rounded-full px-2.5 py-1 text-[11px] font-semibold backdrop-blur-sm",
              urgency.imminent
                ? "bg-primary text-primary-foreground"
                : "bg-background/85 text-foreground"
            )}
          >
            {urgency.label}
          </span>
        ) : null}

        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-card/80 to-transparent"
        />
      </Link>

      <div className="flex flex-1 flex-col gap-1.5 p-4 pt-3.5">
        {/* The strongest text on the card. */}
        <Link href={href} className="focus-ring text-[1.0625rem] font-semibold leading-snug tracking-tight hover:underline">
          {plan.title}
        </Link>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.8125rem] text-muted-foreground">
          {time ? <span>{time}</span> : null}
          {plan.placeText ? (
            <span className="inline-flex min-w-0 items-center gap-1">
              <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span className="truncate">{plan.placeText}</span>
            </span>
          ) : null}
        </div>

        <p className="truncate text-[0.8125rem] text-muted-foreground">Hosted by {plan.organiserName}</p>

        {/* Real faces, from the projection's capped attendee list. Shown only
            when someone has actually said they are going. */}
        {going ? (
          <div className="flex items-center gap-2 pt-0.5">
            {plan.attendees.length > 0 ? (
              <span className="flex -space-x-2" aria-hidden="true">
                {plan.attendees.slice(0, 4).map((attendee, index) => (
                  <UserAvatar
                    key={`${attendee.name}-${index}`}
                    src={attendee.avatarUrl}
                    name={attendee.name}
                    size="xs"
                    decorative
                    className="shadow-[0_2px_6px_-2px_hsl(var(--shadow)/0.6)] ring-2 ring-card"
                  />
                ))}
              </span>
            ) : (
              <Users className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
            )}
            <span className="text-[0.8125rem] font-medium text-muted-foreground">{going}</span>
          </div>
        ) : null}

        {slots?.afterMeta}

        <div className="mt-auto pt-3">
          <Button
            type="button"
            variant={join.kind === "going" ? "outline" : "primary"}
            className="min-h-[44px] w-full"
            disabled={pending || join.disabled}
            onClick={() => onJoin(plan)}
          >
            {join.kind === "going" ? <Check className="h-4 w-4" aria-hidden="true" /> : null}
            {join.label}
          </Button>
        </div>
      </div>
    </article>
  );
}

export const SocializePlanCard = memo(PlanCard);

/** Card-shaped skeleton, matching the real card so arrivals cause no reflow. */
export function SocializePlanCardSkeleton() {
  return (
    <div
      aria-hidden="true"
      className="flex h-full flex-col overflow-hidden rounded-3xl border border-border/60 bg-card/50"
    >
      <div className="aspect-[16/9] w-full animate-pulse bg-secondary/50 motion-reduce:animate-none" />
      <div className="flex flex-1 flex-col gap-2 p-4">
        <div className="h-5 w-3/4 animate-pulse rounded bg-secondary/50 motion-reduce:animate-none" />
        <div className="h-3 w-1/2 animate-pulse rounded bg-secondary/40 motion-reduce:animate-none" />
        <div className="mt-auto pt-3">
          <div className="h-11 w-full animate-pulse rounded-xl bg-secondary/40 motion-reduce:animate-none" />
        </div>
      </div>
    </div>
  );
}
