import { redirect } from "next/navigation";

import { VerificationPage } from "@/components/settings/verification-page";
import { activeRestrictions } from "@/lib/admin/service";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getCurrentUserRecord } from "@/lib/supabase/auth";
import { loadLatestVerificationRequest, verificationRestrictionReason } from "@/lib/trust/verification-application";
import { verificationApplicationEligibility } from "@/lib/trust/verification-application-model";

export const dynamic = "force-dynamic";

export default async function SettingsVerificationPage() {
  const user = await getCurrentUserRecord();
  if (!user) redirect("/login");

  const admin = createSupabaseAdminClient();
  const [{ data: profile }, restrictions, request, { data: verification }] = await Promise.all([
    admin.from("profiles").select("is_onboarded, deleted_at, avatar_url").eq("user_id", user.id).maybeSingle(),
    activeRestrictions(admin, user.id),
    loadLatestVerificationRequest(admin, user.id),
    admin.from("account_verifications").select("status").eq("user_id", user.id).eq("verification_type", "manual_review").maybeSingle()
  ]);

  const isVerifiedAccount = verification?.status === "verified";

  const eligibilityMessage = isVerifiedAccount || (request && ["pending", "under_review", "verified"].includes(request.status))
    ? null
    : !user.email_confirmed_at
    ? "Confirm your email before applying."
    : !profile?.is_onboarded || profile.deleted_at
      ? "Complete your active profile before applying."
      : verificationRestrictionReason(restrictions) ?? verificationApplicationEligibility({
          createdAt: user.created_at,
          profilePhotoUrl: profile.avatar_url
        });

  return <VerificationPage request={request} eligibilityMessage={eligibilityMessage} isVerifiedAccount={isVerifiedAccount} />;
}
