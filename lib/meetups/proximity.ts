import "server-only";

import { createHash } from "node:crypto";
import type { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { haversineMeters } from "@/lib/proximity/backend";
import { canUpdateArrival, type Meetup, type MeetupProximityStage } from "@/lib/meetups/rules";

type Admin = ReturnType<typeof createSupabaseAdminClient>;

export const MEETUP_FIX_MAX_AGE_MS = 2 * 60_000;
const AT_SPOT_METERS = 120;
const NEARBY_METERS = 600;
const GETTING_CLOSER_METERS = 2500;

function participantKey(userId: string, meetupId: string) {
  return createHash("md5").update(userId + meetupId).digest("hex");
}

function stageForDistance(distance: number): MeetupProximityStage | null {
  if (distance <= AT_SPOT_METERS) return "at_spot";
  if (distance <= NEARBY_METERS) return "nearby";
  if (distance <= GETTING_CLOSER_METERS) return "getting_closer";
  return null;
}

/**
 * Adds only coarse, temporary Meetup Glow states.
 *
 * Accepted participation is the meetup-level consent: there is no second
 * "share location" toggle. Raw coordinates never leave this server projection.
 * Ghost Mode, active Privacy Zones, blocks, stale fixes and the location kill
 * switch still fail closed.
 */
export async function addMeetupProximity(
  admin: Admin,
  viewerId: string,
  meetups: Meetup[],
  now = Date.now()
): Promise<Meetup[]> {
  const cleaned = meetups.map((m) => ({
    ...m,
    members: m.members.map((p) => {
      const next = { ...p };
      delete next.proximityStage;
      delete next.observedAt;
      return next;
    })
  }));

  const active = cleaned.filter((m) => canUpdateArrival(m, viewerId, now));
  if (!active.length) return cleaned;

  try {
    const meetupIds = active.map((m) => m.id);
    const [beacons, participantRows] = await Promise.all([
      admin
        .from("meetup_beacons")
        .select("meetup_id,latitude,longitude,state")
        .in("meetup_id", meetupIds),
      admin
        .from("meetup_participants")
        .select("meetup_id,user_id,response,arrival")
        .in("meetup_id", meetupIds)
    ]);

    if (beacons.error || participantRows.error) return cleaned;

    const beaconByMeetup = new Map((beacons.data ?? []).map((b) => [b.meetup_id, b]));
    if (!beaconByMeetup.size) return cleaned;

    const acceptedRows = (participantRows.data ?? []).filter(
      (p) => p.response === "accepted" && p.arrival !== "left" && beaconByMeetup.has(p.meetup_id)
    );
    const userIds = [...new Set(acceptedRows.map((p) => p.user_id))];
    if (!userIds.length) return cleaned;

    const [locations, profiles, zones, blocks] = await Promise.all([
      admin
        .from("user_locations")
        .select("user_id,latitude,longitude,confidence,last_updated")
        .in("user_id", userIds),
      admin
        .from("profiles")
        .select("user_id,visibility_status")
        .in("user_id", userIds),
      admin
        .from("privacy_zones")
        .select("user_id,latitude,longitude,radius")
        .in("user_id", userIds)
        .eq("is_active", true),
      admin
        .from("blocked_users")
        .select("blocker_id,blocked_id")
        .or(`blocker_id.eq.${viewerId},blocked_id.eq.${viewerId}`)
    ]);

    if (locations.error || profiles.error || zones.error || blocks.error) return cleaned;

    const ghostIds = new Set(
      (profiles.data ?? []).filter((p) => p.visibility_status === "ghost").map((p) => p.user_id)
    );
    const blockedIds = new Set(
      (blocks.data ?? [])
        .flatMap((b) => [b.blocker_id, b.blocked_id])
        .filter((id) => id !== viewerId)
    );

    const locationByUser = new Map(
      (locations.data ?? [])
        .filter((location) => {
          const age = now - Date.parse(location.last_updated);
          if (!Number.isFinite(age) || age < -15_000 || age > MEETUP_FIX_MAX_AGE_MS) return false;
          if (ghostIds.has(location.user_id) || blockedIds.has(location.user_id)) return false;
          return !(zones.data ?? []).some(
            (zone) =>
              zone.user_id === location.user_id &&
              haversineMeters(location, zone) <= zone.radius
          );
        })
        .map((location) => [location.user_id, location])
    );

    const stageByKey = new Map<string, MeetupProximityStage>();
    for (const row of acceptedRows) {
      const beacon = beaconByMeetup.get(row.meetup_id);
      const location = locationByUser.get(row.user_id);
      if (!beacon || !location) continue;
      const stage = stageForDistance(haversineMeters(location, beacon));
      if (!stage) continue;
      stageByKey.set(participantKey(row.user_id, row.meetup_id), stage);
    }

    const observedAt = new Date(now).toISOString();
    const activeIds = new Set(active.map((m) => m.id));
    return cleaned.map((m) => {
      if (!activeIds.has(m.id)) return m;
      return {
        ...m,
        members: m.members.map((member) => {
          const stage = stageByKey.get(member.key);
          return stage ? { ...member, proximityStage: stage, observedAt } : member;
        })
      };
    });
  } catch {
    return cleaned;
  }
}
