"use client";

import type { Route } from "next";
import Link from "next/link";
import { Check, MapPin, Users } from "lucide-react";
import { memo, type CSSProperties, type ReactNode } from "react";
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
import { GlareHover } from "@/components/ui/glare-hover";
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
        "group linkr-plan",
        // The nearest plan carries a slightly brighter edge. One card lifted,
        // never a row of competing highlights.
        urgency.imminent && "linkr-plan-imminent"
      )}
      style={
        cover.source === "upload"
          ? undefined
          : ({
              // The category's own gradient IS the card, rather than a strip
              // above a white block. An uploaded cover takes the same role
              // below, as an image layer.
              "--linkr-plan-from": cover.art.from,
              "--linkr-plan-to": cover.art.to
            } as CSSProperties)
      }
    >
      {cover.source === "upload" ? (
        // eslint-disable-next-line @next/next/no-img-element -- signed cover URL, not a static asset
        <img
          src={cover.imageUrl}
          alt=""
          loading="lazy"
          decoding="async"
          className="linkr-plan-image"
        />
      ) : null}

      {/* A scrim only over uploaded photography. The generated gradients are
          already dark enough to carry white text, and layering a scrim on them
          just muddies the colour. */}
      {cover.source === "upload" ? <span aria-hidden="true" className="linkr-plan-scrim" /> : null}

      {/* Decorative sheen only. It sits ABOVE the cover and BELOW the body, so
          it can never dim the text, and it is pointer-transparent so it cannot
          swallow a tap on the card. Remove this element entirely and the card
          still works exactly as before. */}
      <GlareHover
        width="100%"
        height="100%"
        background="transparent"
        borderRadius="inherit"
        borderColor="transparent"
        glareOpacity={0.1}
        glareAngle={-30}
        glareSize={280}
        transitionDuration={800}
        triggerOnParent
        autoOnTouch
        autoDelay={2600}
        autoInterval={9500}
        // z-0, not z-1: .linkr-plan-body is `position: relative` with no
        // z-index of its own, so it paints in the default layer. A positive
        // z-index here would lift the sheen ABOVE the title and CTA and wash
        // them out. This keeps it over the cover art and under the content.
        className="pointer-events-none absolute inset-0 z-0"
      />

      <div className="linkr-plan-body">
        {/* THE DATE, as an object rather than a line of text. It is the first
            thing worth knowing about a plan. */}
        {date ? (
          <span className="linkr-plan-date" aria-hidden="true">
            <span className="linkr-plan-date-weekday">{date.weekday}</span>
            <span className="linkr-plan-date-day">{date.day}</span>
            <span className="linkr-plan-date-month">{date.month}</span>
          </span>
        ) : null}

        <div className="linkr-plan-detail">
          <Link href={href} className="focus-ring linkr-plan-title">
            {plan.title}
          </Link>

          <div className="linkr-plan-meta">
            {time ? <span>{time}</span> : null}
            {urgency.label ? <span className="linkr-plan-urgency">{urgency.label}</span> : null}
            {plan.placeText ? (
              <span className="inline-flex min-w-0 items-center gap-1">
                <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span className="truncate">{plan.placeText}</span>
              </span>
            ) : null}
          </div>

          <p className="linkr-plan-host">Hosted by {plan.organiserName}</p>

          {/* Real faces, from the projection's capped attendee list. Shown
              only when someone has actually said they are going. */}
          {going ? (
            <div className="linkr-plan-going">
              {plan.attendees.length > 0 ? (
                <span className="flex -space-x-2" aria-hidden="true">
                  {plan.attendees.slice(0, 3).map((attendee, index) => (
                    <UserAvatar
                      key={`${attendee.name}-${index}`}
                      src={attendee.avatarUrl}
                      name={attendee.name}
                      size="xs"
                      decorative
                      className="linkr-plan-avatar"
                    />
                  ))}
                </span>
              ) : (
                <Users className="h-3.5 w-3.5" aria-hidden="true" />
              )}
              <span>{going}</span>
            </div>
          ) : null}

          {slots?.afterMeta}
        </div>

        {/* The RSVP, as a pill on the cover.
            ONE control here, matching the Event card. Urgency used to stack
            ABOVE the button in this column, and a flex column is as wide as
            its widest child -- so a long label like "This weekend" set the
            column's width and the event information gave up everything it
            took. The badge now sits inline with the meta, where it wraps
            with the rest of the copy instead of stealing the row. */}
        <div className="linkr-plan-actions">
          <button
            type="button"
            className={cn("linkr-plan-cta", join.kind === "going" && "linkr-plan-cta-going")}
            disabled={pending || join.disabled}
            onClick={() => onJoin(plan)}
          >
            {join.kind === "going" ? <Check className="h-4 w-4" aria-hidden="true" /> : null}
            {join.label}
          </button>
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
