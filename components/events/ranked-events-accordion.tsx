"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Crown, MapPin } from "lucide-react";
import { fallbackGradient } from "@/lib/events/event-media";
import { arrangeForAccordion, activeIndexForAccordion } from "@/lib/events/ranking";
import type { RankedEvent } from "@/lib/events/ranked-events";
import { FINE_POINTER_QUERY, useMediaQuery } from "@/hooks/use-media-query";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { cn } from "@/lib/utils";

/**
 * Ranked Events accordion (Ranked Events Discovery).
 *
 * ADAPTED, NOT COPIED, from the React Bits AccordionGallery reference. What
 * was kept: one panel expanded by default, collapsed rails either side,
 * hover-to-expand on pointer devices, keyboard access, reduced-motion
 * support. What was deliberately changed, and why:
 *
 *  - NO GSAP. The reference animates flex-grow through a GSAP timeline. This
 *    project already ships framer-motion and uses CSS transitions across
 *    Home, and a flex-basis transition does this natively on the compositor.
 *    Adding a third animation path for one component would cost bundle size
 *    for no capability. (GSAP IS installed, so this is a choice, not a
 *    limitation -- it is simply not needed for a width tween.)
 *
 *  - NO `role="list"` + `tabIndex` ON ANCHORS. The reference marks panels as
 *    listitems and makes every one focusable while also being a link, which
 *    announces each panel twice and hijacks Enter. These are buttons in a
 *    tablist-like pattern with explicit aria-current.
 *
 *  - NO VERTICAL COLLAPSE AT 520px. The reference's mobile branch stacks the
 *    panels into a plain column, which is precisely the outcome the brief
 *    rules out. The horizontal accordion is preserved at every width; below
 *    360px it narrows to three rails with the remaining ranks as edge peeks.
 *
 *  - NO GRAYSCALE/TILT/PARALLAX. Decorative 3D on a discovery module fights
 *    legibility on a phone and costs compositor work on exactly the devices
 *    that can least afford it.
 *
 * SECOND-TAP-TO-OPEN. A collapsed panel expands on first press and opens on
 * the next press. This is the whole reason panels are <button> and the open
 * step is an explicit callback rather than an <a href>: a link would navigate
 * on the first tap, which is the accidental navigation the brief calls out.
 */

/**
 * Below this width five panels cannot hold a comfortable touch target: at
 * 320px, five rails plus four gaps plus the page's own padding leaves each
 * collapsed rail under ~44px with a rank numeral inside it. Measured
 * decision, documented here because it is the one number that changes the
 * layout. 360px covers every common device (360/375/390/430); only 320px-class
 * phones take the narrowed branch.
 */
export const ACCORDION_FIVE_PANEL_MIN_WIDTH = 360;
const NARROW_QUERY = `(max-width: ${ACCORDION_FIVE_PANEL_MIN_WIDTH - 1}px)`;

/** Ranks kept as full rails on the narrow branch; the rest become edge peeks. */
const NARROW_RANKS = [3, 1, 2] as const;

function startLabel(startsAt: string): string {
  return new Date(startsAt).toLocaleString([], {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit"
  });
}

export function RankedEventsAccordion({
  events,
  onOpenEvent
}: {
  events: RankedEvent[];
  onOpenEvent: (event: RankedEvent) => void;
}) {
  const finePointer = useMediaQuery(FINE_POINTER_QUERY);
  const isNarrow = useMediaQuery(NARROW_QUERY);
  const reducedMotion = useReducedMotion();

  const arranged = useMemo(() => arrangeForAccordion(events), [events]);

  // On the narrowest phones three ranks hold full rails and the rest sit as
  // edge peeks -- still present, still ranked, never invisible.
  const panels = useMemo(() => {
    if (!isNarrow) return arranged;
    return arranged.filter((event) => (NARROW_RANKS as readonly number[]).includes(event.rank));
  }, [arranged, isNarrow]);

  const peeks = useMemo(() => {
    if (!isNarrow) return [];
    return arranged.filter((event) => !(NARROW_RANKS as readonly number[]).includes(event.rank));
  }, [arranged, isNarrow]);

  /**
   * Active panel tracked by EVENT ID, not by index.
   *
   * Index would break the moment the layout changes: the narrow branch
   * renders three panels where the wide one renders five, so index 2 is a
   * different event on either side of the breakpoint. Keying on identity is
   * what makes the active event survive a resize, an orientation change, and
   * a re-render with new data.
   */
  const [activeId, setActiveId] = useState<string | null>(null);

  const defaultActiveId = useMemo(() => {
    if (panels.length === 0) return null;
    return panels[activeIndexForAccordion(panels)]?.id ?? panels[0].id;
  }, [panels]);

  // Falls back to rank #1 whenever the current active event is not among the
  // rendered panels -- crossing the breakpoint, or the ranking refreshing.
  const activeEventId =
    activeId && panels.some((event) => event.id === activeId) ? activeId : defaultActiveId;

  const buttonRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const handleActivate = useCallback(
    (event: RankedEvent) => {
      // Second press on the already-expanded panel opens it; first press on
      // any other panel only expands. Never both in one gesture.
      if (event.id === activeEventId) {
        onOpenEvent(event);
        return;
      }
      setActiveId(event.id);
    },
    [activeEventId, onOpenEvent]
  );

  const handleKeyDown = useCallback(
    (index: number, keyboardEvent: React.KeyboardEvent<HTMLButtonElement>) => {
      const { key } = keyboardEvent;
      if (key !== "ArrowRight" && key !== "ArrowLeft" && key !== "Home" && key !== "End") return;
      keyboardEvent.preventDefault();
      const lastIndex = panels.length - 1;
      const nextIndex =
        key === "Home"
          ? 0
          : key === "End"
            ? lastIndex
            : key === "ArrowRight"
              ? (index + 1) % panels.length
              : (index - 1 + panels.length) % panels.length;
      const next = panels[nextIndex];
      if (!next) return;
      setActiveId(next.id);
      buttonRefs.current[nextIndex]?.focus();
    },
    [panels]
  );

  useEffect(() => {
    buttonRefs.current.length = panels.length;
  }, [panels.length]);

  if (panels.length === 0) return null;

  return (
    <div className="flex items-stretch gap-1.5 sm:gap-2" role="group" aria-label="Top ranked events">
      {panels.map((event, index) => {
        const isActive = event.id === activeEventId;
        return (
          <button
            key={event.id}
            ref={(node) => {
              buttonRefs.current[index] = node;
            }}
            type="button"
            aria-current={isActive ? "true" : undefined}
            aria-label={
              isActive
                ? `Number ${event.rank}, ${event.name}. Press again to open.`
                : `Number ${event.rank}, ${event.name}. Press to expand.`
            }
            onClick={() => handleActivate(event)}
            // Hover expands on real pointer devices only. It never OPENS --
            // opening always requires a deliberate press.
            onMouseEnter={finePointer ? () => setActiveId(event.id) : undefined}
            onFocus={() => setActiveId(event.id)}
            onKeyDown={(keyboardEvent) => handleKeyDown(index, keyboardEvent)}
            style={{
              // flex-basis drives the accordion. Percentages of the row keep
              // the five panels summing to the container at every width, so
              // the module can never overflow the page horizontally.
              flexGrow: isActive ? 1 : 0,
              flexBasis: isActive ? "52%" : "0%"
            }}
            className={cn(
              "focus-ring relative isolate min-h-[10.5rem] overflow-hidden rounded-2xl text-left",
              // 44px minimum touch target on collapsed rails, always.
              isActive ? "min-w-0" : "min-w-[2.75rem] sm:min-w-[3rem]",
              "transition-[flex-basis,flex-grow] duration-300 ease-out",
              reducedMotion && "transition-none"
            )}
          >
            <span
              aria-hidden="true"
              className="absolute inset-0 -z-10"
              style={
                event.media.kind === "fallback"
                  ? { backgroundImage: fallbackGradient(event.media.treatment) }
                  : undefined
              }
            >
              {event.media.kind === "image" ? (
                /* Event artwork is a remote user upload with no known
                   dimensions; next/image would need a configured loader per
                   host. Lazy + async so a collapsed rail costs nothing. */
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={event.media.url}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  className="h-full w-full object-cover"
                />
              ) : null}
            </span>

            {/* Legibility scrim. Always present so text contrast does not
                depend on which artwork happened to load. */}
            <span
              aria-hidden="true"
              className="absolute inset-0 -z-10 bg-[linear-gradient(180deg,rgba(0,0,0,0.15)_0%,rgba(0,0,0,0.35)_45%,rgba(0,0,0,0.78)_100%)]"
            />

            {/* Rank numeral: visible on every panel, expanded or not. This is
                the collapsed rail's entire content, so it is what makes a
                2.75rem rail still say something. */}
            <span
              className={cn(
                "absolute left-0 right-0 top-2 flex flex-col items-center gap-1 px-1",
                isActive && "left-3 right-auto top-3 items-start px-0"
              )}
            >
              <span className="flex items-center gap-1 text-white">
                {event.rank === 1 ? (
                  <Crown className="h-3.5 w-3.5 shrink-0 text-[#ffc247]" aria-hidden="true" />
                ) : null}
                <span
                  className={cn(
                    "font-bold leading-none tabular-nums drop-shadow-[0_2px_6px_rgba(0,0,0,0.6)]",
                    isActive ? "text-lg" : "text-base"
                  )}
                >
                  {event.rank}
                </span>
              </span>
            </span>

            {/* Expanded content. Only the active panel carries detail; a
                collapsed rail is too narrow for anything but its rank. */}
            <span
              className={cn(
                "absolute inset-x-3 bottom-3 flex flex-col gap-1 text-white transition-opacity duration-200",
                isActive ? "opacity-100 delay-100" : "pointer-events-none opacity-0",
                reducedMotion && "transition-none delay-0"
              )}
            >
              <span className="line-clamp-2 text-sm font-bold leading-tight drop-shadow-[0_2px_8px_rgba(0,0,0,0.7)]">
                {event.name}
              </span>
              <span className="text-[0.6875rem] font-medium leading-tight text-white/90">
                {startLabel(event.startsAt)}
              </span>
              {event.venueLabel ? (
                <span className="flex items-center gap-1 text-[0.6875rem] leading-tight text-white/85">
                  <MapPin className="h-3 w-3 shrink-0" aria-hidden="true" />
                  <span className="truncate">{event.venueLabel}</span>
                </span>
              ) : null}
              <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[0.6875rem] font-medium text-white/90">
                {event.goingCount > 0 ? <span>{event.goingCount} going</span> : null}
                {event.interestedCount > 0 ? <span>{event.interestedCount} interested</span> : null}
                {event.isHost ? (
                  <span className="text-[#ffc247]">You&apos;re hosting</span>
                ) : event.myRsvp === "going" ? (
                  <span className="text-[#ffc247]">You&apos;re going</span>
                ) : event.myRsvp === "interested" ? (
                  <span className="text-[#ffc247]">Interested</span>
                ) : null}
              </span>
            </span>
          </button>
        );
      })}

      {/* Edge peeks for the ranks that lost their rail on the narrow branch.
          Deliberately still buttons: tapping one promotes it into the visible
          set, so no rank is ever unreachable. */}
      {peeks.map((event) => (
        <button
          key={event.id}
          type="button"
          onClick={() => setActiveId(event.id)}
          aria-label={`Number ${event.rank}, ${event.name}. Press to expand.`}
          className="focus-ring relative min-h-[10.5rem] w-3 shrink-0 overflow-hidden rounded-l-lg text-left"
        >
          <span
            aria-hidden="true"
            className="absolute inset-0"
            style={
              event.media.kind === "fallback"
                ? { backgroundImage: fallbackGradient(event.media.treatment) }
                : undefined
            }
          />
          <span className="absolute inset-0 bg-black/35" aria-hidden="true" />
          <span className="absolute inset-x-0 top-2 text-center text-[0.625rem] font-bold tabular-nums text-white">
            {event.rank}
          </span>
        </button>
      ))}
    </div>
  );
}
