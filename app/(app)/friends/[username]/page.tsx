import { notFound } from "next/navigation";
import { MuddyProfilePage } from "@/components/friends/muddy-profile-page";
import { checkFeature } from "@/lib/billing/entitlements";
import { resolveUserEntitlements } from "@/lib/billing/service";
import { getPublicTrustSummary } from "@/lib/discovery/service";
import { loadFriendGlowColors } from "@/lib/glow/custom-colors-server";
import { getVisibleProfileFields, resolveViewerRelationship } from "@/lib/profile/service";
import { areApprovedMuddies } from "@/lib/social/permissions";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function MuddyProfileRoute({ params }: { params: Promise<{ username: string }> }) {
  const { username } = await params;
  const admin = createSupabaseAdminClient();

  const { data: profile } = await admin
    .from("profiles")
    .select("user_id, full_name, username, bio, mood_status")
    .eq("username", username)
    .maybeSingle();

  if (!profile) {
    notFound();
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  const trust =
    user && user.id !== profile.user_id
      ? await getPublicTrustSummary(admin, user.id, profile.user_id)
      : null;

  // Per-field privacy (batch 9 §12): hidden fields never leave the server.
  const relationship = user ? await resolveViewerRelationship(admin, user.id, profile.user_id) : "stranger";
  const fields = user ? await getVisibleProfileFields(admin, profile.user_id, relationship) : null;

  // Custom glow (custom_glow_styles entitlement): only offer the picker when
  // the viewer can actually use it and this is a real Muddy of theirs.
  const isOwnProfile = Boolean(user && user.id === profile.user_id);
  const [entitlements, areFriends, glowColors] = user && !isOwnProfile
    ? await Promise.all([
        resolveUserEntitlements(admin, user.id),
        areApprovedMuddies(admin, user.id, profile.user_id),
        loadFriendGlowColors(admin, user.id)
      ])
    : [null, false, {} as Record<string, string>];
  const canCustomizeGlow = Boolean(entitlements && checkFeature(entitlements, "custom_glow_styles") && areFriends);

  return (
    <MuddyProfilePage
      muddy={{
        friendId: profile.user_id,
        displayName: profile.full_name,
        username: profile.username,
        bio: fields?.bio ?? "",
        moodStatus: profile.mood_status ?? "",
        mutualMuddies: trust?.mutualCount ?? 0
      }}
      trust={trust}
      fields={fields}
      canCustomizeGlow={canCustomizeGlow}
      isMuddy={areFriends}
      initialGlowColorId={glowColors[profile.user_id] ?? null}
    />
  );
}
