"use server";

import { getCurrentUserRecord } from "@/lib/supabase/auth";
import { createMeetupDiscovery, updateMeetupDiscovery } from "@/lib/meetups/discovery-service";

export async function createMeetupDiscoveryAction(input: unknown) {
  const user = await getCurrentUserRecord();
  if (!user) return { ok: false, message: "Sign in to meet new people." };
  return createMeetupDiscovery(user.id, input);
}

export async function updateMeetupDiscoveryAction(input: unknown) {
  const user = await getCurrentUserRecord();
  if (!user) return { ok: false, message: "Sign in to update this listing." };
  return updateMeetupDiscovery(user.id, input);
}

export async function saveMeetupDiscoveryAction(input: unknown, create = false) {
  return create ? createMeetupDiscoveryAction(input) : updateMeetupDiscoveryAction(input);
}
