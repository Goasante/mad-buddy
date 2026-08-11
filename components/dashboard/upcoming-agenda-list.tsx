import Link from "next/link";
import { CalendarDays, MapPin, Sparkles, Users } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { resolvePlanCover } from "@/lib/plans/plan-covers";
import { planDateParts, planTimeLabel } from "@/lib/plans/discovery";
import type { UpcomingAgendaItem } from "@/lib/social/upcoming-agenda";
import { cn } from "@/lib/utils";

/**
 * "My Upcoming": the mixed Plan/Event agenda (Plans + Events lifecycle,
 * Stage C).
 *
 * A NEW component rather than an extension of PlanStack
 * (components/socialize/plan-stack.tsx). PlanStack is shared with Linkr
 * discovery and carries real drag-stack interaction built around exactly one
 * domain shape (HomeUpcomingPlan); folding Events into it would have forced
 * every one of its existing behaviours -- the framer-motion stack, the join
 * action, the reordering guard -- to account for a second shape they were
 * never designed for. A plain chronological list is also the more honest
 * presentation here: "soonest first" is the entire point of a mixed agenda,
 * and a card stack that lets you flick past items obscures exactly that.
 *
 * PLAN AND EVENT SHARE A SHELL, VISIBLY DIFFERENT. Same card proportions,
 * same date treatment, so the two read as one list -- but the type indicator
 * (PLAN / EVENT) and the action each shows are never the same, because their
 * underlying actions genuinely differ: a Plan may say Going / Maybe / Can't
 * make it, an Event only ever Going or Hosting here (Interested-only events
 * never reach this list at all -- see loadUpcomingAgenda).
 */
export function UpcomingAgendaList({ items }: { items: readonly UpcomingAgendaItem[] }) {
  if (items.length === 0) return null;

  return (
    <ul className="space-y-2" aria-label="Your upcoming plans and events">
      {items.map((item) => (
        <li key={`${item.kind}:${item.id}`}>
          {item.kind === "plan" ? <PlanAgendaRow item={item} /> : <EventAgendaRow item={item} />}
        </li>
      ))}
    </ul>
  );
}

function AgendaDate({ startsAt }: { startsAt: string }) {
  const parts = planDateParts(startsAt);
  const time = planTimeLabel(startsAt);
  if (!parts) return null;
  return (
    <div className="flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-xl border border-border/70 bg-card/60">
      <span className="text-[0.65rem] font-semibold uppercase leading-none text-muted-foreground">
        {parts.month}
      </span>
      <span className="text-base font-bold leading-tight">{parts.day}</span>
      {time ? <span className="text-[0.6rem] leading-none text-muted-foreground">{time}</span> : null}
    </div>
  );
}

function PlanAgendaRow({ item }: { item: Extract<UpcomingAgendaItem, { kind: "plan" }> }) {
  const cover = resolvePlanCover({ category: item.category, coverImageUrl: item.coverImageUrl });
  return (
    <Link
      href={item.href}
      className="focus-ring safe-motion flex min-h-[4.5rem] items-center gap-3 rounded-xl border border-border/70 bg-card/50 p-3 hover:bg-secondary/30"
    >
      {cover.source === "upload" ? (
        // eslint-disable-next-line @next/next/no-img-element -- signed cover URL, not a static asset
        <img
          src={cover.imageUrl}
          alt=""
          className="h-12 w-12 shrink-0 rounded-xl object-cover"
        />
      ) : (
        <div
          className="h-12 w-12 shrink-0 rounded-xl"
          style={{ background: `linear-gradient(160deg, ${cover.art.from}, ${cover.art.to})` }}
          aria-hidden="true"
        />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <Badge className="shrink-0 px-1.5 py-0.5 text-[0.6rem]">Plan</Badge>
          <p className="truncate text-sm font-semibold">{item.title}</p>
        </div>
        <p className="mt-0.5 flex items-center gap-1 truncate text-xs text-muted-foreground">
          <CalendarDays className="h-3 w-3 shrink-0" aria-hidden="true" />
          {planTimeLabel(item.startsAt) ?? item.startsAt}
          {item.locationLabel ? (
            <>
              <span aria-hidden="true">·</span>
              <MapPin className="h-3 w-3 shrink-0" aria-hidden="true" />
              <span className="truncate">{item.locationLabel}</span>
            </>
          ) : null}
        </p>
      </div>
      <AgendaDate startsAt={item.startsAt} />
    </Link>
  );
}

function EventAgendaRow({ item }: { item: Extract<UpcomingAgendaItem, { kind: "event" }> }) {
  return (
    <Link
      href={item.href}
      className="focus-ring safe-motion flex min-h-[4.5rem] items-center gap-3 rounded-xl border border-border/70 bg-card/50 p-3 hover:bg-secondary/30"
    >
      <div className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-violet-400/12 text-violet-600 dark:text-violet-200">
        <Sparkles className="h-5 w-5" aria-hidden="true" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <Badge variant="violet" className="shrink-0 px-1.5 py-0.5 text-[0.6rem]">
            Event
          </Badge>
          <p className="truncate text-sm font-semibold">{item.title}</p>
          {/*
            Only Going or Hosting ever reach this list -- see loadUpcomingAgenda's
            filter -- so the two are the only states shown here, matching the
            "not premature Check-in" rule: this is a chronological agenda card,
            not the Event detail page's fuller participation surface.
          */}
          {item.isHost ? (
            <Badge variant="blue" className={cn("shrink-0 px-1.5 py-0.5 text-[0.6rem]")}>
              Hosting
            </Badge>
          ) : (
            <Badge variant="green" className="shrink-0 px-1.5 py-0.5 text-[0.6rem]">
              Going
            </Badge>
          )}
        </div>
        <p className="mt-0.5 flex items-center gap-1 truncate text-xs text-muted-foreground">
          <CalendarDays className="h-3 w-3 shrink-0" aria-hidden="true" />
          {planTimeLabel(item.startsAt) ?? item.startsAt}
          {item.locationLabel ? (
            <>
              <span aria-hidden="true">·</span>
              <MapPin className="h-3 w-3 shrink-0" aria-hidden="true" />
              <span className="truncate">{item.locationLabel}</span>
            </>
          ) : null}
          {!item.isHost ? (
            <>
              <span aria-hidden="true">·</span>
              <Users className="h-3 w-3 shrink-0" aria-hidden="true" />
              <span className="truncate">Hosted by {item.hostName}</span>
            </>
          ) : null}
        </p>
      </div>
      <AgendaDate startsAt={item.startsAt} />
    </Link>
  );
}
