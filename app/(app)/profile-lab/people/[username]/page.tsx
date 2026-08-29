import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { MuddyProfileVNext } from "@/components/friends/muddy-profile-vnext";
import { checkFeature } from "@/lib/billing/entitlements";
import { loadEffectivePlan, resolveUserEntitlements } from "@/lib/billing/service";
import { getPublicTrustSummary } from "@/lib/discovery/service";
import { loadFriendGlowColors } from "@/lib/glow/custom-colors-server";
import { loadProfileIdentitySummary } from "@/lib/profile/identity-service";
import { loadVisibleProfilePhotosFor } from "@/lib/profile/photo-service";
import { getVisibleProfileFields, resolveViewerRelationship } from "@/lib/profile/service";
import { getSafetyAdminContext } from "@/lib/safety/admin";
import { areApprovedMuddies, isBlockedEitherDirection } from "@/lib/social/permissions";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { hasVerifiedAccountStatus } from "@/lib/trust/verified-account";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "People Profile Lab",
  robots: { index: false, follow: false }
};

export default async function ProfileLabPersonPage({ params }: { params: Promise<{ username: string }> }) {
  const labAccess = await getSafetyAdminContext();
  if (!labAccess.ok) redirect("/friends");

  const { username } = await params;
  const admin = createSupabaseAdminClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("user_id, full_name, username, avatar_url, mood_status, trusted_member_since")
    .eq("username", username)
    .is("deleted_at", null)
    .maybeSingle();

  if (!profile) notFound();

  const supabase = await createSupabaseServerClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (user.id === profile.user_id) redirect("/profile-lab");
  if (await isBlockedEitherDirection(admin, user.id, profile.user_id)) notFound();

  const relationship = await resolveViewerRelationship(admin, user.id, profile.user_id);
  const [trust, verificationRows, fields, profilePlan, identitySummary, entitlements, areFriends] = await Promise.all([
    getPublicTrustSummary(admin, user.id, profile.user_id),
    admin.from("account_verifications").select("status").eq("user_id", profile.user_id),
    getVisibleProfileFields(admin, profile.user_id, relationship),
    loadEffectivePlan(admin, profile.user_id),
    loadProfileIdentitySummary(admin, profile.user_id, relationship),
    resolveUserEntitlements(admin, user.id),
    areApprovedMuddies(admin, user.id, profile.user_id)
  ]);

  const photos = await loadVisibleProfilePhotosFor(admin, profile.user_id, {
    isOwner: false,
    isApprovedMuddy: areFriends
  });
  const canCustomizeGlow = checkFeature(entitlements, "custom_glow_styles") && areFriends;
  const glowColors = areFriends ? await loadFriendGlowColors(admin, user.id, entitlements) : {};

  return (
    <MuddyProfileVNext
      muddy={{
        friendId: profile.user_id,
        displayName: profile.full_name,
        username: profile.username,
        avatarUrl: profile.avatar_url,
        bio: fields.bio ?? "",
        moodStatus: areFriends ? (profile.mood_status ?? "") : "",
        mutualMuddies: trust?.mutualCount ?? 0,
        plan: profilePlan,
        trustedSince: profile.trusted_member_since ?? null,
        isVerifiedAccount: hasVerifiedAccountStatus(verificationRows.data ?? [])
      }}
      photos={photos}
      trust={trust}
      fields={fields}
      identitySummary={identitySummary}
      canCustomizeGlow={canCustomizeGlow}
      isMuddy={areFriends}
      initialGlowColorId={glowColors[profile.user_id] ?? null}
    />
  );
}
