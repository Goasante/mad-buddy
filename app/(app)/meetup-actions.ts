"use server";
import { getCurrentUserRecord } from "@/lib/supabase/auth";
import { saveMeetupCommand } from "@/lib/meetups/commands";

export async function saveMeetupAction(input: unknown, create = false) {
  const user = await getCurrentUserRecord();
  if (!user) return { ok: false, message: "Sign in to arrange a meetup." };
  return saveMeetupCommand(user.id, input, create);
}
