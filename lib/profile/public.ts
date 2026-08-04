import "server-only";

import { z } from "zod";
import { areApprovedMuddies, isBlockedEitherDirection } from "@/lib/social/permissions";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSupabaseServerEnv } from "@/lib/supabase/env";
import { getVisibleProfileFields, resolveViewerRelationship } from "@/lib/profile/service";
import { loadEffectivePlan } from "@/lib/billing/service";
import type { SubscriptionPlan } from "@/lib/supabase/database.types";
import { loadProfileIdentitySummary } from "@/lib/profile/identity-service";
import type { ProfileIdentitySummary } from "@/lib/profile/identity";

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
  age: number | null;
  zodiacSign: string | null;
  birthdayToday: boolean;
  birthdayTomorrow: boolean;
  birthdayCountdownDays: number | null;
  nextBirthdayDate: string | null;
  plan: SubscriptionPlan;
  identity: ProfileIdentitySummary;
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
  const [isMuddy, relationship, plan] = await Promise.all([
    isSelf ? Promise.resolve(false) : areApprovedMuddies(admin, viewerId, targetId),
    resolveViewerRelationship(admin, viewerId, targetId),
    loadEffectivePlan(admin, targetId)
  ]);
  const [fields, identity] = await Promise.all([
    getVisibleProfileFields(admin, targetId, relationship),
    loadProfileIdentitySummary(admin, targetId, relationship)
  ]);

  return {
    id: profile.user_id,
    displayName: profile.full_name,
    username: profile.username,
    avatarUrl: profile.avatar_url,
    // Bio/mood are shown to self and to Muddies; strangers get the basics only.
    bio: fields.bio,
    moodStatus: isSelf || isMuddy ? profile.mood_status : null,
    isMuddy,
    isSelf,
    age: fields.age,
    zodiacSign: fields.zodiacSign,
    birthdayToday: fields.birthdayToday,
    birthdayTomorrow: fields.birthdayTomorrow,
    birthdayCountdownDays: fields.birthdayCountdownDays,
    nextBirthdayDate: fields.nextBirthdayDate,
    plan,
    identity
  };
}
