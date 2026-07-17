import { DashboardPageContent } from "@/components/dashboard/dashboard-page";
import { getCurrentSubscriptionAccess } from "@/lib/premium/access";
import { ensureProfileForUser } from "@/lib/profiles/ensure-profile";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function DashboardPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  const [access, profile] = user
    ? await Promise.all([getCurrentSubscriptionAccess(user.id), ensureProfileForUser(user)])
    : [null, null];

  return (
    <div className="dashboard-redesign">
      <DashboardPageContent
        subscriptionPlan={access?.plan}
        hasPremium={access?.hasPremium}
        initialVisibilityStatus={profile?.visibility_status ?? "visible"}
        displayName={profile?.full_name?.split(" ")[0] || "there"}
      />
    </div>
  );
}
