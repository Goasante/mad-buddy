import { notFound, redirect } from "next/navigation";
import { MuddyProfilePage } from "@/components/friends/muddy-profile-page";
import { checkFeature } from "@/lib/billing/entitlements";
import { loadEffectivePlan, resolveUserEntitlements } from "@/lib/billing/service";
import { getPublicTrustSummary } from "@/lib/discovery/service";
import { loadFriendGlowColors } from "@/lib/glow/custom-colors-server";
import { getVisibleProfileFields, resolveViewerRelationship } from "@/lib/profile/service";
import { areApprovedMuddies, isBlockedEitherDirection } from "@/lib/social/permissions";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { loadProfileIdentitySummary } from "@/lib/profile/identity-service";

export default async function MuddyProfileRoute({ params }: { params: Promise<{ username: string }> }) {
  const { username } = await params;
  const admin = createSupabaseAdminClient();

  const { data: profile } = await admin
    .from("profiles")
    .select("user_id, full_name, username, avatar_url, bio, mood_status")
    .eq("username", username)
    .maybeSingle();

  if (!profile) {
    notFound();
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (user?.id === profile.user_id) {
    redirect("/profile");
  }

  if (user && (await isBlockedEitherDirection(admin, user.id, profile.user_id))) {
    notFound();
  }

  const trust =
    user && user.id !== profile.user_id
      ? await getPublicTrustSummary(admin, user.id, profile.user_id)
      : null;

  // Per-field privacy (batch 9 §12): hidden fields never leave the server.
  const relationship = user ? await resolveViewerRelationship(admin, user.id, profile.user_id) : "stranger";
  const [fields, profilePlan, identitySummary] = await Promise.all([
    user ? getVisibleProfileFields(admin, profile.user_id, relationship) : Promise.resolve(null),
    loadEffectivePlan(admin, profile.user_id),
    loadProfileIdentitySummary(admin, profile.user_id, relationship)
  ]);

  // Custom glow (custom_glow_styles entitlement): only offer the picker when
  // the viewer can actually use it and this is a real Muddy of theirs.
  const isOwnProfile = Boolean(user && user.id === profile.user_id);
  const [entitlements, areFriends] = user && !isOwnProfile
    ? await Promise.all([
        resolveUserEntitlements(admin, user.id),
        areApprovedMuddies(admin, user.id, profile.user_id)
      ])
    : [null, false];
  const canCustomizeGlow = Boolean(entitlements && checkFeature(entitlements, "custom_glow_styles") && areFriends);
  const glowColors =
    user && entitlements && areFriends
      ? await loadFriendGlowColors(admin, user.id, entitlements)
      : {};

  return (
    <MuddyProfilePage
      muddy={{
        friendId: profile.user_id,
        displayName: profile.full_name,
        username: profile.username,
        avatarUrl: profile.avatar_url,
        bio: fields?.bio ?? "",
        moodStatus: areFriends ? (profile.mood_status ?? "") : "",
        mutualMuddies: trust?.mutualCount ?? 0,
        plan: profilePlan
      }}
      trust={trust}
      fields={fields}
      identitySummary={identitySummary}
      canCustomizeGlow={canCustomizeGlow}
      isMuddy={areFriends}
      initialGlowColorId={glowColors[profile.user_id] ?? null}
    />
  );
}
