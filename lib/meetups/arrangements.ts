import "server-only";
import { z } from "zod";
import type { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { meetupReadyForHome, meetupSchema, type MeetupHomeItem } from "@/lib/meetups/rules";
import { batchEligibleMuddyIds } from "@/lib/social/permissions";

type Admin = ReturnType<typeof createSupabaseAdminClient>;
export async function loadMeetups(admin: Admin, actorId: string) {
  const expiry = await admin.rpc("expire_meetups_server");
  if (expiry.error) throw expiry.error;
  const { data, error } = await admin.rpc("list_meetups_server", { p_actor_id: actorId });
  if (error) throw error;
  return z.array(meetupSchema).parse(data);
}

export async function loadMeetupHome(admin: Admin, actorId: string): Promise<MeetupHomeItem[]> {
  const meetups = await loadMeetups(admin, actorId);
  return meetups.flatMap((m) => {
    const response = m.members.find((p) => p.userId === actorId)?.response;
    return meetupReadyForHome(m, actorId, Date.now())
      ? [{
          id: m.id,
          mode: m.mode,
          startsAt: m.startsAt,
          timezone: m.timezone,
          placeLabel: m.placeLabel,
          title: m.title,
          category: m.category,
          sourceDiscoveryId: m.sourceDiscoveryId,
          response
        }] : [];
  }).slice(0, 8);
}

export async function loadMeetupMuddies(admin: Admin, actorId: string) {
  const { data, error } = await admin.from("friendships").select("user_one_id,user_two_id")
    .or(`user_one_id.eq.${actorId},user_two_id.eq.${actorId}`).is("ended_at", null);
  if (error) throw error;
  const ids = [...new Set((data ?? []).map((r) => r.user_one_id === actorId ? r.user_two_id : r.user_one_id))];
  if (!ids.length) return [];
  const eligible = await batchEligibleMuddyIds(admin, actorId, ids);
  const allowed = ids.filter((id) => eligible.has(id));
  if (!allowed.length) return [];
  const profiles = await admin.from("profiles").select("user_id,full_name,username").in("user_id", allowed);
  if (profiles.error) throw profiles.error;
  return (profiles.data ?? []).map((p) => ({ id: p.user_id, name: p.full_name || p.username || "A Muddy" }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
