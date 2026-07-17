import "server-only";

import { resolveEventGlow } from "@/lib/events/rules";
import { areApprovedMuddies, isBlockedEitherDirection } from "@/lib/social/permissions";
import type { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { EventCircleRole } from "@/lib/supabase/database.types";

/**
 * Events server service (spec §61: canCheckIn / buildEventGlowList /
 * canJoinEventCircle / canModerateEventCircle). Every decision routes through
 * the pure rules in lib/events/rules.ts; this layer only supplies facts.
 */

type Admin = ReturnType<typeof createSupabaseAdminClient>;

/** The event-token signing secret. Reuses the service-role key as key material. */
export function eventTokenSecret(): string | null {
  return process.env.SUPABASE_SERVICE_ROLE_KEY ?? null;
}

export type EventGlowMuddy = {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  status: string | null;
};

/**
 * Builds the Event Glow list for a viewer at an event (spec §39). Returns only
 * users the viewer is authorized to see. Users who are present but private,
 * ghosted, or Glow-disabled are simply absent — the response never discloses
 * that they are at the event at all (spec §41).
 *
 * Never touches coordinates: presence here means "has a live check-in".
 */
export async function buildEventGlowList(
  admin: Admin,
  eventId: string,
  viewerId: string,
  nowMs = Date.now()
): Promise<{ count: number; muddies: EventGlowMuddy[] }> {
  const { data: event } = await admin
    .from("events")
    .select("id, status, starts_at, ends_at")
    .eq("id", eventId)
    .maybeSingle();
  if (!event) return { count: 0, muddies: [] };

  const eventActive =
    event.status !== "cancelled" &&
    event.status !== "draft" &&
    nowMs <= Date.parse(event.ends_at);

  // The viewer must hold a live check-in themselves.
  const { data: viewerCheckIn } = await admin
    .from("check_ins")
    .select("id")
    .eq("user_id", viewerId)
    .eq("context_type", "event")
    .eq("context_id", eventId)
    .eq("status", "checked_in")
    .maybeSingle();
  if (!viewerCheckIn || !eventActive) return { count: 0, muddies: [] };

  const { data: checkIns } = await admin
    .from("check_ins")
    .select("user_id, visibility, event_glow_enabled")
    .eq("context_type", "event")
    .eq("context_id", eventId)
    .eq("status", "checked_in")
    .neq("user_id", viewerId);

  const candidates = checkIns ?? [];
  if (candidates.length === 0) return { count: 0, muddies: [] };

  const candidateIds = candidates.map((row) => row.user_id);
  const [{ data: profiles }, { data: statuses }] = await Promise.all([
    admin.from("profiles").select("user_id, full_name, avatar_url, visibility_status").in("user_id", candidateIds),
    admin
      .from("user_statuses")
      .select("user_id, availability_type, expires_at")
      .in("user_id", candidateIds)
      .gt("expires_at", new Date(nowMs).toISOString())
  ]);

  const profileById = new Map((profiles ?? []).map((profile) => [profile.user_id, profile]));
  const statusById = new Map((statuses ?? []).map((status) => [status.user_id, status]));

  const visible: EventGlowMuddy[] = [];
  for (const candidate of candidates) {
    const profile = profileById.get(candidate.user_id);
    if (!profile) continue;

    const [mutual, blocked] = await Promise.all([
      areApprovedMuddies(admin, viewerId, candidate.user_id),
      isBlockedEitherDirection(admin, viewerId, candidate.user_id)
    ]);

    const decision = resolveEventGlow({
      viewerCheckedIn: true,
      targetCheckedIn: true,
      targetGlowEnabled: candidate.event_glow_enabled,
      targetVisibility: candidate.visibility,
      areApprovedMuddies: mutual,
      isBlockedEitherDirection: blocked,
      targetGhostMode: profile.visibility_status === "ghost",
      eventActive
    });
    if (!decision.visible) continue;

    visible.push({
      userId: candidate.user_id,
      displayName: profile.full_name?.trim() || "A Muddy",
      avatarUrl: profile.avatar_url,
      status: statusById.get(candidate.user_id)?.availability_type ?? null
    });
  }

  return { count: visible.length, muddies: visible };
}

/** A user's live check-in for a context, if any. */
export async function liveCheckIn(
  admin: Admin,
  userId: string,
  contextType: "event" | "plan" | "place" | "circle",
  contextId: string
) {
  const { data } = await admin
    .from("check_ins")
    .select("id, status, visibility, event_glow_enabled, checked_in_at")
    .eq("user_id", userId)
    .eq("context_type", contextType)
    .eq("context_id", contextId)
    .eq("status", "checked_in")
    .maybeSingle();
  return data ?? null;
}

export type EventCircleAccess = {
  exists: boolean;
  role: EventCircleRole | null;
  isMember: boolean;
  isBanned: boolean;
};

export async function resolveEventCircleAccess(
  admin: Admin,
  userId: string,
  circleId: string
): Promise<EventCircleAccess> {
  const { data: circle } = await admin
    .from("event_circles")
    .select("id, owner_id")
    .eq("id", circleId)
    .maybeSingle();
  if (!circle) return { exists: false, role: null, isMember: false, isBanned: false };

  const { data: member } = await admin
    .from("event_circle_members")
    .select("role, status")
    .eq("event_circle_id", circleId)
    .eq("user_id", userId)
    .maybeSingle();

  if (circle.owner_id === userId) {
    return { exists: true, role: "host", isMember: true, isBanned: false };
  }
  if (!member) return { exists: true, role: null, isMember: false, isBanned: false };

  return {
    exists: true,
    role: member.role,
    isMember: member.status === "joined",
    isBanned: member.status === "banned"
  };
}

export async function eventCircleMemberCount(admin: Admin, circleId: string): Promise<number> {
  const { count } = await admin
    .from("event_circle_members")
    .select("id", { count: "exact", head: true })
    .eq("event_circle_id", circleId)
    .eq("status", "joined");
  return count ?? 0;
}
