import type { EventRsvpStatus } from "@/lib/supabase/database.types";
import type { HomeUpcomingPlan } from "@/lib/social/upcoming-plans";

export type PlanAgendaItem = HomeUpcomingPlan & {
  kind: "plan";
  id: string;
  title: string;
  startsAt: string;
  endsAt: string | null;
};

export type EventAgendaItem = {
  kind: "event";
  id: string;
  title: string;
  startsAt: string;
  endsAt: string;
  locationLabel: string | null;
  href: `/events?event=${string}`;
  isHost: boolean;
  myRsvp: EventRsvpStatus | null;
  hostName: string;
};

export type UpcomingAgendaItem = PlanAgendaItem | EventAgendaItem;

export type UpcomingAgendaResult = {
  items: UpcomingAgendaItem[];
  hasMore: boolean;
};

/** Build the single Home agenda without changing either underlying domain. */
export function projectUpcomingAgenda(
  items: readonly UpcomingAgendaItem[],
  nowMs: number,
  limit: number
): UpcomingAgendaItem[] {
  const unique = new Map<string, UpcomingAgendaItem>();

  for (const item of items) {
    const startsAtMs = Date.parse(item.startsAt);
    const endsAtMs = item.endsAt ? Date.parse(item.endsAt) : startsAtMs;
    if (!Number.isFinite(startsAtMs) || !Number.isFinite(endsAtMs) || endsAtMs < nowMs) continue;
    unique.set(`${item.kind}:${item.id}`, item);
  }

  return [...unique.values()]
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))
    .slice(0, Math.max(0, limit));
}
