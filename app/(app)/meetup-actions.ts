"use server";
import { getCurrentUserRecord } from "@/lib/supabase/auth";
import { saveMeetupCommand } from "@/lib/meetups/commands";
import { createMeetupDiscovery, updateMeetupDiscovery } from "@/lib/meetups/discovery-service";

export async function saveMeetupAction(input: unknown, create = false) {
  const user = await getCurrentUserRecord();
  if (!user) return { ok: false, message: "Sign in to arrange a meetup." };
  return saveMeetupCommand(user.id, input, create);
}


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
