import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { ProfileMediaVNext } from "@/components/profile/profile-media-vnext";
import { loadProfileIdentitySummary } from "@/lib/profile/identity-service";
import { loadVisibleProfilePhotosFor } from "@/lib/profile/photo-service";
import { getSafetyAdminContext } from "@/lib/safety/admin";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Profile Media Lab",
  robots: { index: false, follow: false }
};

export default async function ProfileLabMediaPage() {
  const labAccess = await getSafetyAdminContext();
  if (!labAccess.ok) redirect("/profile");

  const supabase = await createSupabaseServerClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, avatar_url")
    .eq("user_id", user.id)
    .maybeSingle();

  const admin = createSupabaseAdminClient();
  const [photos, identitySummary] = await Promise.all([
    loadVisibleProfilePhotosFor(admin, user.id, { isOwner: true, isApprovedMuddy: false }),
    loadProfileIdentitySummary(admin, user.id, "self")
  ]);

  return (
    <ProfileMediaVNext
      displayName={profile?.full_name ?? user.user_metadata?.full_name ?? "Your profile"}
      avatarUrl={profile?.avatar_url ?? null}
      photos={photos}
      momentCount={identitySummary?.activity?.momentCount ?? 0}
    />
  );
}
