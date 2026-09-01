import { redirect } from "next/navigation";

import { AccessSettingsPage, type AccessBillingSummary } from "@/components/access/access-settings-page";
import { hasEverHadWelcomeAccess } from "@/lib/access/guard";
import { resolveAccessForUser } from "@/lib/access/resolver";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/supabase/auth";

export const dynamic = "force-dynamic";

export default async function AccessSettingsRoute() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const admin = createSupabaseAdminClient();
  const [access, hadWelcomeAccess, subscriptionResult] = await Promise.all([
    resolveAccessForUser(user.id),
    hasEverHadWelcomeAccess(user.id),
    admin
      .from("subscriptions")
      .select("provider, plan, status, current_period_end, cancel_at_period_end, paystack_subscription_code")
      .eq("user_id", user.id)
      .maybeSingle()
  ]);

  const row = subscriptionResult.data;
  const billing: AccessBillingSummary | null = row
    ? {
        provider: row.provider ?? null,
        product: row.plan ?? null,
        status: row.status ?? null,
        currentPeriodEnd: row.current_period_end ?? null,
        cancelAtPeriodEnd: Boolean(row.cancel_at_period_end),
        canCancelHere: row.provider === "paystack" && Boolean(row.paystack_subscription_code)
      }
    : null;

  return <AccessSettingsPage access={access} hadWelcomeAccess={hadWelcomeAccess} billing={billing} />;
}
