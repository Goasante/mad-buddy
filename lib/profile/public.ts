import "server-only";

import { z } from "zod";
import type { ProfilePhoto } from "@/lib/profile/profile-photos";
import { loadVisibleProfilePhotosFor } from "@/lib/profile/photo-service";
import { areApprovedMuddies, isBlockedEitherDirection } from "@/lib/social/permissions";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSupabaseServerEnv } from "@/lib/supabase/env";
import { getVisibleProfileFields, resolveViewerRelationship } from "@/lib/profile/service";
import { loadEffectivePlan } from "@/lib/billing/service";
import type { SubscriptionPlan } from "@/lib/supabase/database.types";
import { loadProfileIdentitySummary } from "@/lib/profile/identity-service";
import type { ProfileIdentitySummary } from "@/lib/profile/identity";
import { hasVerifiedAccountStatus, type VerificationRow } from "@/lib/trust/verified-account";

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
  /**
   * Gallery photos this viewer is authorised to see, already filtered by the
   * server. A photo absent from this array was never sent.
   */
  photos: ProfilePhoto[];
  /** Trusted Member approval, or null. Never implies an identity check. */
  trustedSince: string | null;
  /** Server-authoritative identity verification state. Separate from Premium and Trusted Member. */
  isVerifiedAccount: boolean;
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
    .select(
      "user_id, full_name, username, avatar_url, bio, mood_status, deleted_at, visibility_status, trusted_member_since"
    )
    .eq("user_id", targetId)
    .maybeSingle();
  if (!profile || profile.deleted_at) return null;

  // Computed BEFORE the batch below, not inside it. A value declared by a
  // destructuring assignment cannot be read by the expressions producing that
  // same assignment, so `isSelf` has to exist first for the friendship read to
  // branch on it.
  const isSelf = viewerId === targetId;

  const [verificationRows, isMuddy, relationship, plan] = await Promise.all([
    admin
      .from("account_verifications")
      .select("status")
      .eq("user_id", targetId)
      .maybeSingle()
      .then((result) => (result.data ? [result.data as VerificationRow] : [])),
    isSelf ? Promise.resolve(false) : areApprovedMuddies(admin, viewerId, targetId),
    resolveViewerRelationship(admin, viewerId, targetId),
    loadEffectivePlan(admin, targetId)
  ]);
  const [fields, identity, photos] = await Promise.all([
    getVisibleProfileFields(admin, targetId, relationship),
    loadProfileIdentitySummary(admin, targetId, relationship),
    /**
     * The gallery, filtered SERVER-SIDE.
     *
     * A photo the viewer may not see never reaches the client — not hidden
     * with CSS, not filtered in a component. `isMuddy` above already means
     * an ACTIVE friendship (areApprovedMuddies checks ended_at IS NULL), and
     * a block returned null long before this line, so the two hardest cases
     * are settled by the time the gallery is read.
     */
    loadVisibleProfilePhotosFor(admin, targetId, { isOwner: isSelf, isApprovedMuddy: isMuddy })
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
    identity,
    photos,
    /**
     * Trusted Member, straight from the profile row already being read.
     * Never inferred from plan or tenure: those are separate signals, and
     * conflating them is what "Verified" would have implied.
     */
    trustedSince: profile.trusted_member_since ?? null,
    isVerifiedAccount: hasVerifiedAccountStatus(verificationRows)
  };
}
