import "server-only";

import { eventPhase } from "@/lib/events/rules";
import { batchBlockedIds } from "@/lib/social/permissions";
import { isUpcomingPlan } from "@/lib/social/plans";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSupabaseServerEnv } from "@/lib/supabase/env";
import type { EventRsvpStatus, PlanCategory, PlanStatus } from "@/lib/supabase/database.types";

/**
 * "My Upcoming": the personal agenda, Plans and Events merged into one
 * chronological list (Plans + Events lifecycle, Stage C).
 *
 * A NEW, PARALLEL PROJECTION -- deliberately not a change to
 * `HomeUpcomingPlan` (lib/social/upcoming-plans.ts). That type has five
 * unrelated consumers (dashboard, hangout, reminders, discovery-feed,
 * discovery-rails), each expecting a Plan and nothing else; turning it into a
 * Plan/Event union would have forced every one of them to handle a case they
 * were never built for. This module reads its own data and produces its own
 * shape; `loadUpcomingPlans` is untouched and keeps serving exactly the
 * callers it already had.
 *
 * NOT A DATABASE MERGE. Plans and Events remain two separate tables with two
 * separate domain models (lib/social/plans.ts, lib/events/rules.ts); this is
 * a read-time presentation projection over both, the same relationship
 * `HomeUpcomingPlan` already has to `plans`.
 */

export type PlanAgendaItem = {
  kind: "plan";
  id: string;
  title: string;
  startsAt: string;
  /** Plans commonly have none; the union does not force one on Events. */
  endsAt: string | null;
  locationLabel: string | null;
  href: `/plans?plan=${string}`;
  /** Host role counts as going, the same rule loadUpcomingPlans already uses. */
  myRsvp: string;
  category: PlanCategory | null;
  coverImageUrl: string | null;
};

export type EventAgendaItem = {
  kind: "event";
  id: string;
  title: string;
  startsAt: string;
  /** Always present -- events.ends_at is NOT NULL, unlike a Plan's. */
  endsAt: string;
  locationLabel: string | null;
  href: `/events?event=${string}`;
  isHost: boolean;
  /** null when hosting: a host is never asked to RSVP to their own event. */
  myRsvp: EventRsvpStatus | null;
  hostName: string;
};

export type UpcomingAgendaItem = PlanAgendaItem | EventAgendaItem;

const MAX_AGENDA_ITEMS = 12;

function hasServiceRoleEnv(): boolean {
  const env = getSupabaseServerEnv();
  return Boolean(env.url && env.serviceRoleKey);
}

/**
 * Loads and merges both halves, then performs ONE chronological sort.
 *
 * NOT "sort Plans, sort Events, concatenate" -- that produces
 * Plan/Plan/Plan/Event/Event even when an Event is soonest, because each half
 * only knows its own order. Both lists are combined first and the single sort
 * below is what actually decides position.
 */
export async function loadUpcomingAgenda(userId: string, limit = MAX_AGENDA_ITEMS): Promise<UpcomingAgendaItem[]> {
  if (!hasServiceRoleEnv()) return [];

  const admin = createSupabaseAdminClient();
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();

  // ---------------------------------------------------------------------
  // Plans: mirrors loadUpcomingPlans' membership rule (participant, not
  // removed, or creator; host counts as going) without re-deriving the
  // lifecycle logic -- isUpcomingPlan is the single source of truth for
  // whether a plan belongs here, same as Stage A+B everywhere else.
  // ---------------------------------------------------------------------
  const [{ data: myPlanRows }, { data: createdPlanRows }] = await Promise.all([
    admin
      .from("plan_participants")
      .select("plan_id, rsvp_status, role")
      .eq("user_id", userId)
      .neq("rsvp_status", "removed"),
    admin.from("plans").select("id").eq("creator_id", userId)
  ]);

  const planIds = [
    ...new Set([...(myPlanRows ?? []).map((row) => row.plan_id), ...(createdPlanRows ?? []).map((row) => row.id)])
  ];
  const myPlanRowByPlan = new Map((myPlanRows ?? []).map((row) => [row.plan_id, row]));

  const planItemsPromise: Promise<PlanAgendaItem[]> = (async () => {
    if (planIds.length === 0) return [];
    const { data } = await admin
      .from("plans")
      .select("id, creator_id, title, start_at, end_at, status, custom_place_text, category, cover_image_url")
      .in("id", planIds)
      .in("status", ["inviting", "polling", "confirmed"])
      .not("start_at", "is", null)
      .or(`start_at.gte.${nowIso},end_at.gte.${nowIso}`);

    return (data ?? [])
      .filter((plan) =>
        isUpcomingPlan({ status: plan.status as PlanStatus, startAt: plan.start_at, endAt: plan.end_at }, nowMs)
      )
      .map((plan) => {
        const myRow = myPlanRowByPlan.get(plan.id);
        const isHost = plan.creator_id === userId || myRow?.role === "host" || myRow?.role === "co_host";
        return {
          kind: "plan" as const,
          id: plan.id,
          title: plan.title,
          startsAt: plan.start_at as string,
          endsAt: plan.end_at,
          locationLabel: plan.custom_place_text,
          href: `/plans?plan=${plan.id}` as const,
          myRsvp: isHost ? "going" : (myRow?.rsvp_status ?? "invited"),
          category: plan.category ?? null,
          coverImageUrl: plan.cover_image_url ?? null
        };
      });
  })();

  // ---------------------------------------------------------------------
  // Events: Going, OR hosting -- Interested-only and Not Going both stay off
  // the primary agenda (spec decision, §18/§22). Upcoming AND currently-live
  // both count: a 7-11pm event does not vanish from the agenda at 7:01,
  // mirroring the Stage A rule that an in-progress Plan with an end time
  // stays current until it actually ends.
  // ---------------------------------------------------------------------
  const [{ data: goingRows }, { data: hostedRows }] = await Promise.all([
    admin.from("event_rsvps").select("event_id").eq("user_id", userId).eq("status", "going"),
    admin.from("events").select("id").eq("host_id", userId)
  ]);

  const goingEventIds = (goingRows ?? []).map((row) => row.event_id);
  const hostedEventIds = (hostedRows ?? []).map((row) => row.id);
  const eventIds = [...new Set([...goingEventIds, ...hostedEventIds])];

  const eventItemsPromise: Promise<EventAgendaItem[]> =
    eventIds.length === 0
      ? Promise.resolve([])
      : (async () => {
          const { data: events } = await admin
            .from("events")
            .select("id, host_id, name, venue_label, starts_at, ends_at, status, visibility")
            .in("id", eventIds)
            .in("status", ["scheduled", "active"])
            .gte("ends_at", nowIso);
          const rows = events ?? [];
          if (rows.length === 0) return [];

          // BLOCK CHECK, same reasoning and same batched helper as the fix in
          // lib/events/mobile.ts: a hosted-or-Going event from a now-blocked
          // host must not linger in the agenda just because the RSVP row (or
          // host_id) still technically exists. Only matters for events this
          // viewer does not themselves host.
          const hostIdsToCheck = [...new Set(rows.map((event) => event.host_id).filter((id) => id !== userId))];
          const blockedHostIds = await batchBlockedIds(admin, userId, hostIdsToCheck);
          const accessible = rows.filter((event) => event.host_id === userId || !blockedHostIds.has(event.host_id));
          if (accessible.length === 0) return [];

          const hostIds = [...new Set(accessible.map((event) => event.host_id))];
          const [{ data: hosts }, { data: rsvps }] = await Promise.all([
            admin.from("profiles").select("user_id, full_name").in("user_id", hostIds),
            admin.from("event_rsvps").select("event_id, status").eq("user_id", userId).in(
              "event_id",
              accessible.map((event) => event.id)
            )
          ]);
          const hostNames = new Map((hosts ?? []).map((row) => [row.user_id, row.full_name]));
          const rsvpByEvent = new Map((rsvps ?? []).map((row) => [row.event_id, row.status]));

          return accessible
            .filter((event) => {
              const isHost = event.host_id === userId;
              const rsvp = rsvpByEvent.get(event.id);
              // Re-checked here rather than trusted from the query above: a
              // Going RSVP changed to Not Going since goingEventIds was read
              // must not leave a stale row in the agenda for this request.
              if (isHost) return true;
              const phase = eventPhase(
                { startsAtMs: Date.parse(event.starts_at), endsAtMs: Date.parse(event.ends_at) },
                nowMs
              );
              return rsvp === "going" && (phase === "upcoming" || phase === "live");
            })
            .map((event) => ({
              kind: "event" as const,
              id: event.id,
              title: event.name,
              startsAt: event.starts_at,
              endsAt: event.ends_at,
              locationLabel: event.venue_label,
              href: `/events?event=${event.id}` as const,
              isHost: event.host_id === userId,
              myRsvp: event.host_id === userId ? null : ((rsvpByEvent.get(event.id) as EventRsvpStatus) ?? null),
              hostName: event.host_id === userId ? "You" : hostNames.get(event.host_id)?.trim() || "A Muddy"
            }));
        })();

  const [planItems, eventItems] = await Promise.all([planItemsPromise, eventItemsPromise]);

  // ONE canonical sort over the MERGED list -- not sort-then-concatenate.
  const merged: UpcomingAgendaItem[] = [...planItems, ...eventItems];
  merged.sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));

  return merged.slice(0, limit);
}
