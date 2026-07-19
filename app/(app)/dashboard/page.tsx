import { DashboardPageContent } from "@/components/dashboard/dashboard-page";
import { getCurrentSubscriptionAccess } from "@/lib/premium/access";
import { ensureProfileForUser } from "@/lib/profiles/ensure-profile";
import { loadUpcomingPlans } from "@/lib/social/upcoming-plans";
import { createSupabaseServerClient } from "@/lib/supabase/server";

function isStatusActiveAtRequestTime(expiresAt: string) {
  return Date.parse(expiresAt) > Date.now();
}

export default async function DashboardPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  const [access, profile, statusResult, upcoming] = user
    ? await Promise.all([
        getCurrentSubscriptionAccess(user.id),
        ensureProfileForUser(user),
        supabase
          .from("user_statuses")
          .select("availability_type, activity_type, custom_text, expires_at")
          .eq("user_id", user.id)
          .maybeSingle(),
        loadUpcomingPlans(user.id)
      ])
    : [null, null, null, { plans: [], hasMore: false }];

  const status = statusResult?.data;
  const hasActiveStatus = Boolean(status && isStatusActiveAtRequestTime(status.expires_at));

  return (
    <DashboardPageContent
      subscriptionPlan={access?.plan}
      hasPremium={access?.hasPremium}
      initialVisibilityStatus={profile?.visibility_status ?? "visible"}
      displayName={profile?.full_name?.split(" ")[0] || ""}
      hasActiveStatus={hasActiveStatus}
      initialStatusAvailability={hasActiveStatus ? status?.availability_type : undefined}
      initialStatusActivity={hasActiveStatus ? status?.activity_type ?? null : null}
      initialStatusNote={hasActiveStatus ? status?.custom_text ?? "" : ""}
      upcomingPlans={upcoming?.plans ?? []}
      hasMorePlans={upcoming?.hasMore ?? false}
    />
  );
}
