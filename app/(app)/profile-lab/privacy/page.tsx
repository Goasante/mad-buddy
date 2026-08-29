import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { getCommunicationPreferencesAction } from "@/app/(app)/messaging-actions";
import { ProfilePrivacyVNext } from "@/components/profile/profile-privacy-vnext";
import { loadFieldPrivacy } from "@/lib/profile/service";
import { getSafetyAdminContext } from "@/lib/safety/admin";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Profile Privacy Lab",
  robots: { index: false, follow: false }
};

export default async function ProfilePrivacyLabPage() {
  const labAccess = await getSafetyAdminContext();
  if (!labAccess.ok) redirect("/settings/privacy");

  const supabase = await createSupabaseServerClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createSupabaseAdminClient();
  const [{ data: profile }, fieldPrivacy, communication] = await Promise.all([
    supabase.from("profiles").select("visibility_status").eq("user_id", user.id).maybeSingle(),
    loadFieldPrivacy(admin, user.id),
    getCommunicationPreferencesAction()
  ]);

  return (
    <ProfilePrivacyVNext
      visibilityStatus={profile?.visibility_status ?? "visible"}
      birthdayVisibility={fieldPrivacy?.birthday === "approved_muddies" ? "approved_muddies" : "only_me"}
      ageVisibility={fieldPrivacy?.age === "approved_muddies" ? "approved_muddies" : "only_me"}
      zodiacVisibility={fieldPrivacy?.zodiac === "approved_muddies" ? "approved_muddies" : "only_me"}
      communication={communication}
    />
  );
}
