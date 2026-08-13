"use client";

import { motion, useMotionValue, useTransform } from "framer-motion";
import Link from "next/link";
import { CalendarDays, MapPin } from "lucide-react";
import { useCallback, useState, type CSSProperties } from "react";

import { SocializePlanCard } from "@/components/socialize/socialize-plan-card";
import type { HomeUpcomingPlan } from "@/lib/social/upcoming-plans";
import type { EventAgendaItem } from "@/lib/social/upcoming-agenda";
import { planDateParts, planTimeLabel } from "@/lib/plans/discovery";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { cn } from "@/lib/utils";

/**
 * Upcoming plans, as a stack rather than a horizontal rail.
 *
 * A rail asks the user to scroll sideways to discover there is anything past
 * the first card; a stack shows the depth immediately. Same cards, same order,
 * far less hidden.
 *
 * CHRONOLOGY IS NOT NEGOTIABLE. The reference Stack component reorders its
 * array on every interaction — the card you send back becomes last, and after
 * one flick the soonest plan is no longer on top. For images that is
 * harmless; for plans it is wrong, because "which is next" is the single most
 * useful fact on the card.
 *
 * So this keeps `plans` untouched and rotates a VIEW index instead. Browsing
 * moves a window over a fixed chronological list, and the counter says where
 * you are in it. Returning to the start always returns to the soonest plan.
 */

/** How many cards are drawn. Beyond three the offsets are indistinguishable. */
const VISIBLE = 3;
/** Drag distance, in px, that advances the stack. */
const ADVANCE_AT = 90;

export function PlanStack({
  plans,
  onJoin,
  pending = false
}: {
  plans: readonly (HomeUpcomingPlan | EventAgendaItem)[];
  onJoin: (plan: HomeUpcomingPlan) => void;
  pending?: boolean;
}) {
  const reducedMotion = useReducedMotion();
  // Which plan is on top. An index into the ORIGINAL order, never a reordering
  // of it.
  const [top, setTop] = useState(0);

  const x = useMotionValue(0);
  // A gentle tilt as the top card is dragged, capped well below the deck's so
  // the two surfaces do not compete.
  const rotate = useTransform(x, [-200, 200], [-8, 8]);

  const count = plans.length;

  const advance = useCallback(() => {
    setTop((current) => (current + 1) % count);
  }, [count]);

  const rewind = useCallback(() => {
    setTop((current) => (current - 1 + count) % count);
  }, [count]);

  if (count === 0) return null;

  // One card needs no stack, no drag and no counter.
  if (count === 1) {
    return <AgendaCard item={plans[0]} onJoin={onJoin} pending={pending} />;
  }

  const visible = Array.from({ length: Math.min(VISIBLE, count) }, (_, depth) => ({
    item: plans[(top + depth) % count],
    depth
  }));

  return (
    <div className="plan-stack-wrap">
      <div
        className="plan-stack"
        // Announced as a list with a position, so the order is available
        // without seeing the offsets.
        role="group"
        aria-roledescription="stack"
        aria-label={`Your plans, showing ${top + 1} of ${count}`}
      >
        {/* Painted back-to-front so the live card sits on top naturally. */}
        {visible
          .slice()
          .reverse()
          .map(({ item, depth }) => {
            const isTop = depth === 0;
            return (
              <motion.div
                key={`${isEventAgendaItem(item) ? "event" : "plan"}:${item.id}`}
                className={cn("plan-stack-card", isTop && "plan-stack-card-live")}
                style={isTop ? { x, rotate, zIndex: VISIBLE } : { zIndex: VISIBLE - depth }}
                animate={{
                  // Behind cards peek out below rather than fanning sideways:
                  // the card is wide and short, so vertical offset reads as
                  // depth where a horizontal one reads as a misaligned row.
                  y: depth * 10,
                  scale: 1 - depth * 0.04,
                  opacity: depth >= VISIBLE - 1 ? 0.55 : 1
                }}
                transition={
                  reducedMotion
                    ? { duration: 0 }
                    : { type: "spring", stiffness: 260, damping: 26 }
                }
                drag={isTop ? "x" : false}
                dragConstraints={{ left: 0, right: 0 }}
                dragElastic={0.35}
                onDragEnd={(_event, info) => {
                  if (info.offset.x < -ADVANCE_AT) advance();
                  else if (info.offset.x > ADVANCE_AT) rewind();
                  // Framer springs x back to 0 via dragConstraints, so the card
                  // returns home whether or not the drag committed.
                }}
                aria-hidden={!isTop}
              >
                <AgendaCard item={item} onJoin={onJoin} pending={pending} />
              </motion.div>
            );
          })}
      </div>

      {/* Position and controls. Buttons, not only a drag: the gesture is an
          enhancement and every plan has to be reachable by keyboard. */}
      <div className="plan-stack-controls">
        <button
          type="button"
          onClick={rewind}
          className="plan-stack-nav"
          aria-label="Previous plan"
        >
          <span aria-hidden="true">‹</span>
        </button>

        <span className="plan-stack-count" aria-live="polite">
          {/* States the ordering out loud, so "1 of 4" plus "soonest first" is
              never something the user has to infer from the offsets. */}
          {top === 0 ? "Soonest" : `${top + 1} of ${count}`}
        </span>

        <button type="button" onClick={advance} className="plan-stack-nav" aria-label="Next plan">
          <span aria-hidden="true">›</span>
        </button>
      </div>
    </div>
  );
}

function isEventAgendaItem(item: HomeUpcomingPlan | EventAgendaItem): item is EventAgendaItem {
  return "kind" in item && item.kind === "event";
}

function AgendaCard({
  item,
  onJoin,
  pending
}: {
  item: HomeUpcomingPlan | EventAgendaItem;
  onJoin: (plan: HomeUpcomingPlan) => void;
  pending: boolean;
}) {
  if (isEventAgendaItem(item)) return <EventAgendaCard event={item} />;
  return <SocializePlanCard plan={item} onJoin={onJoin} pending={pending} />;
}

/** Event presentation using the Plan card's exact shell and spacing. */
function EventAgendaCard({ event }: { event: EventAgendaItem }) {
  const date = planDateParts(event.startsAt);
  const time = planTimeLabel(event.startsAt);
  const state = event.isHost ? "Hosting" : event.myRsvp === "interested" ? "Interested" : "Going";

  return (
    <article
      className="linkr-plan home-agenda-event"
      style={
        {
          "--linkr-plan-from": "#5b21b6",
          "--linkr-plan-to": "#312e81"
        } as CSSProperties
      }
      aria-label={`Event: ${event.title}${time ? ` at ${time}` : ""}, ${state}`}
    >
      <div className="linkr-plan-body">
        {date ? (
          <span className="linkr-plan-date" aria-hidden="true">
            <span className="linkr-plan-date-weekday">{date.weekday}</span>
            <span className="linkr-plan-date-day">{date.day}</span>
            <span className="linkr-plan-date-month">{date.month}</span>
          </span>
        ) : null}

        <div className="linkr-plan-detail">
          {/* The label sits ABOVE the name rather than beside it. Inline, a
              fixed-width badge took room from the one piece of copy that
              actually varies, so a long Event name ellipsed early while
              "Event" kept its full width. */}
          <span className="home-agenda-type">Event</span>
          <Link href={event.href} className="focus-ring linkr-plan-title min-w-0">
            {event.title}
          </Link>
          <div className="linkr-plan-meta">
            {time ? (
              <span className="inline-flex items-center gap-1">
                <CalendarDays className="h-3.5 w-3.5" aria-hidden="true" />
                {time}
              </span>
            ) : null}
            {event.locationLabel ? (
              <span className="inline-flex min-w-0 items-center gap-1">
                <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span className="truncate">{event.locationLabel}</span>
              </span>
            ) : null}
          </div>
          <p className="linkr-plan-host">Hosted by {event.hostName}</p>
        </div>

        <div className="linkr-plan-actions">
          <span className="home-agenda-rsvp">{state}</span>
        </div>
      </div>
    </article>
  );
}
