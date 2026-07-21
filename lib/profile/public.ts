import "server-only";

import { z } from "zod";
import { areApprovedMuddies, isBlockedEitherDirection } from "@/lib/social/permissions";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSupabaseServerEnv } from "@/lib/supabase/env";

/**
 * A viewer-safe public profile card (name, username, avatar, bio, mood) plus
 * the viewer's relationship, so a tapped person leads to a real profile. A block
 * in either direction returns null (indistinguishable from "not found"). Uses
 * the admin client because the base profile RLS is narrow (same reason search
 * runs server-side).
 */

export type PublicProfile = {
  id: string;
  displayName: string;
  username: string;
  avatarUrl: string | null;
  bio: string | null;
  moodStatus: string | null;
  isMuddy: boolean;
  isSelf: boolean;
};

const uuidSchema = z.string().uuid();

export async function getPublicProfile(viewerId: string, targetId: string): Promise<PublicProfile | null> {
  const env = getSupabaseServerEnv();
  if (!env.url || !env.serviceRoleKey) return null;
  if (!uuidSchema.safeParse(targetId).success) return null;

  const admin = createSupabaseAdminClient();

  if (viewerId !== targetId) {
    if (await isBlockedEitherDirection(admin, viewerId, targetId)) return null;
  }

  const { data: profile } = await admin
    .from("profiles")
    .select("user_id, full_name, username, avatar_url, bio, mood_status, deleted_at, visibility_status")
    .eq("user_id", targetId)
    .maybeSingle();
  if (!profile || profile.deleted_at) return null;

  const isSelf = viewerId === targetId;
  const isMuddy = isSelf ? false : await areApprovedMuddies(admin, viewerId, targetId);

  return {
    id: profile.user_id,
    displayName: profile.full_name,
    username: profile.username,
    avatarUrl: profile.avatar_url,
    // Bio/mood are shown to self and to Muddies; strangers get the basics only.
    bio: isSelf || isMuddy ? profile.bio : null,
    moodStatus: isSelf || isMuddy ? profile.mood_status : null,
    isMuddy,
    isSelf
  };
}
