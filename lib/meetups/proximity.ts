import "server-only";
import type { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { haversineMeters } from "@/lib/proximity/backend";
import { canUpdateArrival, type Meetup, type MeetupProximityState } from "@/lib/meetups/rules";

type Admin = ReturnType<typeof createSupabaseAdminClient>;

export const MEETUP_FIX_MAX_AGE_MS = 2 * 60_000;

const AT_SPOT_METERS = 180;
const NEARBY_METERS = 700;
const APPROACHING_METERS = 2500;

function proximityState(distanceMeters: number): MeetupProximityState | null {
  if (distanceMeters <= AT_SPOT_METERS) return "at_spot";
  if (distanceMeters <= NEARBY_METERS) return "nearby";
  if (distanceMeters <= APPROACHING_METERS) return "approaching";
  return null;
}

/**
 * Adds only a coarse, short-lived state to accepted participants.
 * Raw coordinates never leave this server function.
 */
export async function addMeetupProximity(
  admin: Admin,
  viewerId: string,
  meetups: Meetup[],
  now = Date.now()
): Promise<Meetup[]> {
  const cleaned = meetups.map((meetup) => ({
    ...meetup,
    members: meetup.members.map((person) => {
      const next = { ...person };
      delete next.proximityState;
      delete next.observedAt;
      return next;
    })
  }));

  const active = cleaned.filter(
    (meetup) => meetup.beaconStatus && canUpdateArrival(meetup, viewerId, now)
  );
  if (!active.length) return cleaned;

  const meetupIds = active.map((meetup) => meetup.id);
  const participantIds = [...new Set(active.flatMap((meetup) =>
    meetup.members
      .filter((person) => person.userId && person.response === "accepted" && person.arrival !== "left")
      .map((person) => person.userId!)
  ))];
  if (!participantIds.length) return cleaned;

  try {
    const [anchors, locations, profiles, zones, blocks] = await Promise.all([
      admin.from("meetups")
        .select("id,beacon_latitude,beacon_longitude,beacon_status")
        .in("id", meetupIds),
      admin.from("user_locations")
        .select("user_id,latitude,longitude,last_updated")
        .in("user_id", participantIds),
      admin.from("profiles")
        .select("user_id,visibility_status")
        .in("user_id", participantIds),
      admin.from("privacy_zones")
        .select("user_id,latitude,longitude,radius")
        .in("user_id", participantIds)
        .eq("is_active", true),
      admin.from("blocked_users")
        .select("blocker_id,blocked_id")
        .or("blocker_id.eq." + viewerId + ",blocked_id.eq." + viewerId)
    ]);

    if (anchors.error || locations.error || profiles.error || zones.error || blocks.error) {
      return cleaned;
    }

    const anchorMap = new Map(
      (anchors.data ?? [])
        .filter((row) => row.beacon_status && row.beacon_latitude != null && row.beacon_longitude != null)
        .map((row) => [row.id, { latitude: row.beacon_latitude!, longitude: row.beacon_longitude! }])
    );

    const ghostIds = new Set(
      (profiles.data ?? [])
        .filter((profile) => profile.visibility_status === "ghost")
        .map((profile) => profile.user_id)
    );

    const blockedIds = new Set(
      (blocks.data ?? [])
        .flatMap((row) => [row.blocker_id, row.blocked_id])
        .filter((id) => id !== viewerId)
    );

    const locationMap = new Map(
      (locations.data ?? [])
        .filter((location) => {
          const age = now - Date.parse(location.last_updated);
          if (!Number.isFinite(age) || age < -15_000 || age > MEETUP_FIX_MAX_AGE_MS) return false;
          if (ghostIds.has(location.user_id) || blockedIds.has(location.user_id)) return false;
          return !(zones.data ?? []).some(
            (zone) =>
              zone.user_id === location.user_id
              && haversineMeters(location, zone) <= zone.radius
          );
        })
        .map((location) => [location.user_id, location])
    );

    const activeIds = new Set(active.map((meetup) => meetup.id));

    return cleaned.map((meetup) => {
      if (!activeIds.has(meetup.id)) return meetup;
      const anchor = anchorMap.get(meetup.id);
      if (!anchor) return meetup;

      return {
        ...meetup,
        members: meetup.members.map((person) => {
          if (!person.userId || person.response !== "accepted" || person.arrival === "left") return person;
          const location = locationMap.get(person.userId);
          if (!location) return person;
          const state = proximityState(haversineMeters(location, anchor));
          if (!state) return person;
          return {
            ...person,
            proximityState: state,
            observedAt: new Date(now).toISOString()
          };
        })
      };
    });
  } catch {
    return cleaned;
  }
}
