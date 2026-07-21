"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  activateSocialize,
  deactivateSocialize,
  discoverSocializePeople,
  getCurrentSocialize,
  updateSocialize,
  type SocializeActionResult,
  type SocializePerson,
  type SocializeSession
} from "@/lib/social/socialize-mobile";

// The Socialize logic lives in lib/social/socialize-mobile.ts so the mobile
// /api/socialize routes share it. These are thin wrappers that resolve the
// cookie session. A "use server" file can't re-export types, so importers get
// the Socialize types straight from lib/social/socialize-mobile.
export type SocializeActionState = SocializeActionResult;

async function getAuthedUserId(): Promise<string | null> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error
  } = await supabase.auth.getUser();
  return error || !user ? null : user.id;
}

export async function getCurrentSocializeAction(): Promise<SocializeSession | null> {
  const userId = await getAuthedUserId();
  if (!userId) return null;
  return getCurrentSocialize(userId);
}

export async function activateSocializeAction(input: unknown): Promise<SocializeActionState> {
  const userId = await getAuthedUserId();
  if (!userId) return { ok: false, message: "Log in first." };
  return activateSocialize(userId, input);
}

export async function updateSocializeAction(input: unknown): Promise<SocializeActionState> {
  const userId = await getAuthedUserId();
  if (!userId) return { ok: false, message: "Log in first." };
  return updateSocialize(userId, input);
}

export async function deactivateSocializeAction(): Promise<SocializeActionState> {
  const userId = await getAuthedUserId();
  if (!userId) return { ok: false, message: "Log in first." };
  return deactivateSocialize(userId);
}

export async function discoverSocializePeopleAction(): Promise<SocializePerson[]> {
  const userId = await getAuthedUserId();
  if (!userId) return [];
  return discoverSocializePeople(userId);
}
