import { isComingUpUpFor, type UpForTiming } from "@/lib/social/upfor-lifecycle";
import type { UpcomingAgendaItem } from "@/lib/social/upcoming-agenda-projection";

/**
 * Home's "Coming Up": the things that have not happened yet.
 *
 * A HOME PRESENTATION UNION, not a backend entity. A scheduled UpFor stays an
 * UpFor and a Plan stays a Plan -- they are merged only for display, and only
 * because they answer the same question. Flattening them into one stored shape
 * would lose the distinction between a temporary intent and a commitment with
 * participants.
 *
 * Deliberately separate from `UpcomingAgendaItem`. That union is shared with
 * message sharing, which has no business gaining an UpFor variant just because
 * Home wanted one; widening it broke that surface immediately, which is the
 * type system making the right argument.
 */
export type ComingUpItem =
  | { kind: "agenda"; id: string; startsAt: string; item: UpcomingAgendaItem }
  | { kind: "upfor"; id: string; startsAt: string; endsAt: string; title: string; href: string };

export type ComingUpUpForSource = UpForTiming & {
  id: string;
  title: string;
};

/**
 * Merge the agenda with the viewer's own SCHEDULED UpFors, soonest first.
 *
 * What is included, and what is not:
 *
 *   future scheduled UpFor   YES  it has not started
 *   future Plan / Event      YES  the agenda already filters these
 *   ACTIVE UpFor             NO   it is happening, not coming up
 *   cancelled / expired      NO   terminal
 *   converted UpFor          NO   terminal -- it IS the Plan now, and showing
 *                                 both would list one intention twice
 *
 * The converted case is the one worth stating: conversion marks the UpFor
 * `converted_to_plan`, so `isComingUpUpFor` drops it in the same pass that the
 * new Plan appears through the agenda. The handover needs no special casing,
 * and there is no window where both are visible.
 */
export function buildComingUp(
  agenda: readonly UpcomingAgendaItem[],
  upfors: readonly ComingUpUpForSource[],
  nowMs: number,
  limit = 6
): ComingUpItem[] {
  const items: ComingUpItem[] = [];

  for (const item of agenda) {
    const startsMs = Date.parse(item.startsAt);
    if (!Number.isFinite(startsMs)) continue;
    items.push({ kind: "agenda", id: `${item.kind}:${item.id}`, startsAt: item.startsAt, item });
  }

  for (const upfor of upfors) {
    if (!isComingUpUpFor(upfor, nowMs)) continue;
    items.push({
      kind: "upfor",
      id: `upfor:${upfor.id}`,
      startsAt: upfor.startsAt,
      endsAt: upfor.endsAt,
      title: upfor.title,
      href: `/hangout-mode?upfor=${upfor.id}`
    });
  }

  // Sorted by when things actually begin, so the next thing is first whatever
  // type it is. Ties break on id purely so the order is stable between renders
  // rather than shuffling on every tick.
  return items
    .sort((a, b) => {
      const delta = Date.parse(a.startsAt) - Date.parse(b.startsAt);
      return delta !== 0 ? delta : a.id.localeCompare(b.id);
    })
    .slice(0, limit);
}
