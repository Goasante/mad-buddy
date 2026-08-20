"use client";

import { useMemo, useState } from "react";
import { Check, Crown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { EventCompactRow, EventHeroCard, type EventCardFacts } from "@/components/events/event-cards";
import { SectionLabel } from "@/components/events/event-badges";
import { byStartAscending, describeEvent } from "@/lib/events/presentation";
import type { EventView } from "@/lib/events/mobile";
import { cn } from "@/lib/utils";

/**
 * Your Events -- reference panel 3.
 *
 * Everything this viewer has answered, grouped by WHEN rather than by status.
 * Grouping by time is the point: "what am I doing today" is the question this
 * screen gets opened to answer, and a flat RSVP list never answered it.
 *
 * NO RSVP BUTTON GROUP HERE. On a personal list three competing buttons per row
 * is noise -- the answer is already given, so it shows as a state, and changing
 * it happens on the Event's own screen where the context is.
 */

const TABS = [
  { id: "going", label: "Going" },
  { id: "interested", label: "Interested" },
  { id: "invited", label: "Invited" },
  { id: "past", label: "Past" }
] as const;

type YoursTab = (typeof TABS)[number]["id"];

function toFacts(event: EventView, nowMs: number): EventCardFacts {
  const described = describeEvent(event, nowMs);
  return {
    id: event.id,
    name: event.name,
    coverUrl: event.coverUrl,
    focalX: event.focalX,
    focalY: event.focalY,
    venueLabel: event.venueLabel,
    locality: event.locality,
    goingCount: event.goingCount,
    isLive: described.isLive,
    whenLabel: described.whenLabel
  };
}

/** "Going" as a state, not a control. */
function GoingMark() {
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
      <Check className="h-3 w-3" aria-hidden="true" />
      Going
    </span>
  );
}

/** What you are to an Event you run. Never "Going": a host is not an attendee. */
function HostingMark() {
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-muted-foreground">
      <Crown className="h-3 w-3" aria-hidden="true" />
      Hosting
    </span>
  );
}

/** The right state mark for this viewer's relationship to this Event. */
function relationshipMark(event: EventView, tab: YoursTab) {
  if (event.isHost) return <HostingMark />;
  if (event.myRsvp === "going" && tab !== "past") return <GoingMark />;
  return undefined;
}

const EMPTY: Record<YoursTab, { title: string; description: string }> = {
  going: {
    title: "Nothing coming up",
    description: "Events you are going to, and events you host, collect here."
  },
  interested: {
    title: "Nothing on your radar",
    description: "Mark an event Interested and it will wait for you here."
  },
  invited: {
    title: "No invitations right now",
    description: "When a Muddy invites you to an event, you will find it here."
  },
  past: { title: "No past events yet", description: "Events you attended stay here afterwards." }
};

export function EventsYours({
  events,
  nowMs,
  onOpen,
  onBrowse
}: {
  events: EventView[];
  nowMs: number;
  onOpen: (eventId: string) => void;
  onBrowse: () => void;
}) {
  const [tab, setTab] = useState<YoursTab>("going");

  const rows = useMemo(() => {
    /* "YOUR EVENTS" MEANS EVENTS RELEVANT TO YOU -- INCLUDING ONES YOU HOST.
     *
     * This filtered hosted Events out entirely, so somebody who published an
     * Event went looking for it here and found nothing. The reasoning was
     * technically tidy (hosting has its own surface) and wrong for a person:
     * an Event you are running is the most relevant Event you have.
     *
     * IT IS NOT SOLVED BY FAKING AN RSVP. A host does not attend their own
     * Event as a participant -- setEventRsvp refuses it server-side, and
     * inventing a `going` row to make a list work would corrupt attendance
     * counts and the whole Interested/Going/Check-in model. Hosting is a
     * STRONGER relationship than an RSVP, so it is surfaced as its own state.
     *
     * Hosting the surface stays management-oriented (drafts, admins, updates).
     * The same Event appearing in both is correct, not duplication: one asks
     * "what am I doing", the other "what am I running". */
    const isPast = (event: EventView) => describeEvent(event, nowMs).isPast;
    const attending = events.filter((event) => !event.isHost);

    switch (tab) {
      case "interested":
        return attending
          .filter((event) => event.myRsvp === "interested" && !isPast(event))
          .sort(byStartAscending);
      case "invited":
        /* Invited means individually targeted AND not yet answered. Once you
         * reply the Event belongs under your answer -- leaving it here too
         * would put one Event in two tabs at once. A host is never "invited"
         * to their own Event. */
        return attending
          .filter((event) => event.isInvited && !event.myRsvp && !isPast(event))
          .sort(byStartAscending);
      case "past":
        /* Everything you were part of, whether you answered or ran it. A host
         * needs their own finished Events here as much as an attendee does. */
        return events
          .filter((event) => isPast(event) && (event.myRsvp || event.isHost))
          .sort((a, b) => byStartAscending(b, a));
      case "going":
      default:
        /* Going, plus the Events you host. Draft Events are excluded: an
         * unpublished Event is unfinished work, and Hosting is where it is
         * finished. */
        return events
          .filter(
            (event) =>
              !isPast(event) &&
              (event.isHost ? event.status !== "draft" : event.myRsvp === "going")
          )
          .sort(byStartAscending);
    }
  }, [events, nowMs, tab]);

  const { today, thisWeek, later } = useMemo(() => {
    const groups = { today: [] as EventView[], thisWeek: [] as EventView[], later: [] as EventView[] };
    for (const event of rows) {
      const described = describeEvent(event, nowMs);
      if (described.isToday || described.isLive) groups.today.push(event);
      else if (described.isThisWeek) groups.thisWeek.push(event);
      else groups.later.push(event);
    }
    return groups;
  }, [rows, nowMs]);

  // The soonest thing today leads the surface: it is the commitment most likely
  // to need acting on. Past events get no hero -- nothing there is actionable.
  const lead = tab === "past" ? null : today[0] ?? null;
  const todayRest = lead ? today.slice(1) : today;

  return (
    <div className="space-y-5">
      <div role="tablist" aria-label="Your events" className="flex gap-1 rounded-xl bg-secondary/50 p-1">
        {TABS.map((entry) => {
          const active = entry.id === tab;
          return (
            <button
              key={entry.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setTab(entry.id)}
              className={cn(
                "min-h-[2.25rem] flex-1 rounded-lg px-2 text-sm font-medium transition",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                active ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {entry.label}
            </button>
          );
        })}
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title={EMPTY[tab].title}
          description={EMPTY[tab].description}
          action={
            tab === "going" || tab === "interested" ? (
              <Button variant="secondary" onClick={onBrowse}>
                Browse events
              </Button>
            ) : undefined
          }
        />
      ) : null}

      {lead ? (
        <section className="space-y-3">
          <SectionLabel className="px-1">Today</SectionLabel>
          <EventHeroCard
            facts={toFacts(lead, nowMs)}
            onOpen={() => onOpen(lead.id)}
            footer={
              <div className="flex flex-wrap items-center gap-2 text-sm text-white/85">
                <span>{describeEvent(lead, nowMs).whenLabel}</span>
                {lead.isHost ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-white/15 px-2 py-0.5 text-xs font-medium text-white">
                    <Crown className="h-3 w-3" aria-hidden="true" />
                    You&apos;re hosting
                  </span>
                ) : lead.myRsvp === "going" ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-white/15 px-2 py-0.5 text-xs font-medium text-white">
                    <Check className="h-3 w-3" aria-hidden="true" />
                    You&apos;re going
                  </span>
                ) : null}
              </div>
            }
          />
        </section>
      ) : null}

      {[
        { label: tab === "past" ? "Recently" : "Also today", rows: todayRest },
        { label: "This week", rows: thisWeek },
        { label: tab === "past" ? "Earlier" : "Later", rows: later }
      ]
        .filter((group) => group.rows.length > 0)
        .map((group) => (
          <section key={group.label} className="space-y-1">
            <SectionLabel className="px-1">{group.label}</SectionLabel>
            <div className="divide-y divide-border/40">
              {group.rows.map((event) => (
                <EventCompactRow
                  key={event.id}
                  facts={toFacts(event, nowMs)}
                  onOpen={() => onOpen(event.id)}
                  trailing={relationshipMark(event, tab)}
                />
              ))}
            </div>
          </section>
        ))}
    </div>
  );
}
