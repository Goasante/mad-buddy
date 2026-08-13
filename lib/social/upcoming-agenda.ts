import "server-only";

import { eventPhase } from "@/lib/events/rules";
import { batchBlockedIds } from "@/lib/social/permissions";
import { loadUpcomingPlans } from "@/lib/social/upcoming-plans";
import {
  projectUpcomingAgenda,
  type EventAgendaItem,
  type UpcomingAgendaItem,
  type UpcomingAgendaResult
} from "@/lib/social/upcoming-agenda-projection";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSupabaseServerEnv } from "@/lib/supabase/env";
import type { EventRsvpStatus } from "@/lib/supabase/database.types";

export type {
  EventAgendaItem,
  PlanAgendaItem,
  UpcomingAgendaItem,
  UpcomingAgendaResult
} from "@/lib/social/upcoming-agenda-projection";

const MAX_AGENDA_ITEMS = 12;

function hasServiceRoleEnv(): boolean {
  const env = getSupabaseServerEnv();
  return Boolean(env.url && env.serviceRoleKey);
}

/**
 * Loads the canonical Home Plan projection and the viewer's Event intent,
 * then performs one chronological merge. Plans and Events remain separate
 * domain records. This read never writes or upgrades an RSVP state.
 */
export async function loadUpcomingAgenda(
  userId: string,
  limit = MAX_AGENDA_ITEMS
): Promise<UpcomingAgendaResult> {
  if (!hasServiceRoleEnv()) return { items: [], hasMore: false };

  const admin = createSupabaseAdminClient();
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();

  const planItemsPromise = loadUpcomingPlans(userId, limit + 1).then((result) => ({
    items: result.plans.map((plan) => ({
      ...plan,
      kind: "plan" as const,
      startsAt: plan.startAt,
      endsAt: plan.endAt ?? null
    })),
    hasMore: result.hasMore
  }));

  // Interested is the existing consideration state. Going is commitment.
  // Hosting qualifies without requiring an RSVP row.
  const [{ data: intentRows }, { data: hostedRows }] = await Promise.all([
    admin
      .from("event_rsvps")
      .select("event_id, status")
      .eq("user_id", userId)
      .in("status", ["interested", "going"]),
    admin.from("events").select("id").eq("host_id", userId)
  ]);

  const intentEventIds = (intentRows ?? []).map((row) => row.event_id);
  const hostedEventIds = (hostedRows ?? []).map((row) => row.id);
  const eventIds = [...new Set([...intentEventIds, ...hostedEventIds])];

  const eventItemsPromise: Promise<EventAgendaItem[]> =
    eventIds.length === 0
      ? Promise.resolve([])
      : (async () => {
          const { data: events } = await admin
            .from("events")
            .select("id, host_id, name, venue_label, starts_at, ends_at, status, visibility")
            .in("id", eventIds)
            .in("status", ["scheduled", "active"])
            .gte("ends_at", nowIso)
            .order("starts_at", { ascending: true })
            .limit(limit + 1);
          const rows = events ?? [];
          if (rows.length === 0) return [];

          const hostIdsToCheck = [...new Set(rows.map((event) => event.host_id).filter((id) => id !== userId))];
          const blockedHostIds = await batchBlockedIds(admin, userId, hostIdsToCheck);
          const accessible = rows.filter((event) => event.host_id === userId || !blockedHostIds.has(event.host_id));
          if (accessible.length === 0) return [];

          const hostIds = [...new Set(accessible.map((event) => event.host_id))];
          const [{ data: hosts }, { data: currentRsvps }] = await Promise.all([
            admin.from("profiles").select("user_id, full_name").in("user_id", hostIds),
            admin
              .from("event_rsvps")
              .select("event_id, status")
              .eq("user_id", userId)
              .in(
                "event_id",
                accessible.map((event) => event.id)
              )
          ]);
          const hostNames = new Map((hosts ?? []).map((row) => [row.user_id, row.full_name]));
          const rsvpByEvent = new Map((currentRsvps ?? []).map((row) => [row.event_id, row.status]));

          return accessible
            .filter((event) => {
              if (event.host_id === userId) return true;
              const rsvp = rsvpByEvent.get(event.id);
              const phase = eventPhase(
                { startsAtMs: Date.parse(event.starts_at), endsAtMs: Date.parse(event.ends_at) },
                nowMs
              );
              return (rsvp === "interested" || rsvp === "going") && (phase === "upcoming" || phase === "live");
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
              myRsvp:
                event.host_id === userId ? null : ((rsvpByEvent.get(event.id) as EventRsvpStatus | undefined) ?? null),
              hostName: event.host_id === userId ? "You" : hostNames.get(event.host_id)?.trim() || "A Muddy"
            }));
        })();

  const [planResult, eventItems] = await Promise.all([planItemsPromise, eventItemsPromise]);
  const merged: UpcomingAgendaItem[] = [...planResult.items, ...eventItems];
  const items = projectUpcomingAgenda(merged, nowMs, limit);

  return {
    items,
    hasMore: planResult.hasMore || merged.length > items.length
  };
}
