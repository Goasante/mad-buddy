import Link from "next/link";
import type { Route } from "next";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { BillingDetailPanel, type BillingDetailData } from "@/components/admin/billing/billing-detail-panel";
import { getAdminAccess } from "@/lib/admin/access";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSafetyAdminContext } from "@/lib/safety/admin";
import { effectivePlan } from "@/lib/billing/entitlements";
import { entitlementLabel } from "@/lib/admin/billing-admin";

type DetailProps = { params: Promise<{ userId: string }> };

export default async function BillingDetailPage({ params }: DetailProps) {
  const { userId } = await params;
  const admin = createSupabaseAdminClient();
  const context = await getSafetyAdminContext();
  if (!context.ok) redirect("/admin/login");
  const access = await getAdminAccess(admin, context);
  if (!access.permissions.has("admin.billing.view")) redirect("/admin");
  const canManage = access.permissions.has("admin.billing.refund");
  const canManagePlan = access.permissions.has("admin.billing.manage_plan");

  const { data: sub } = await admin
    .from("subscriptions")
    .select("id, plan, status, provider, current_period_start, current_period_end, grace_ends_at, trial_ends_at, cancel_at_period_end, paystack_subscription_code, paystack_customer_code, updated_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (!sub) notFound();

  const [profileRes, changesRes, overridesRes] = await Promise.all([
    admin.from("profiles").select("full_name, username, avatar_url").eq("user_id", userId).maybeSingle(),
    admin.from("subscription_changes").select("id, change_type, from_plan, to_plan, status, effective_at, requested_at, reason").eq("user_id", userId).order("requested_at", { ascending: false }).limit(20),
    admin.from("entitlement_overrides").select("id, entitlement_key, boolean_value, integer_value, value_type, reason, starts_at, ends_at, created_at").eq("subject_type", "user").eq("subject_id", userId).order("created_at", { ascending: false })
  ]);

  const now = new Date().getTime();
  const effective = effectivePlan(
    {
      plan: sub.plan,
      status: sub.status,
      periodEndMs: sub.current_period_end ? Date.parse(sub.current_period_end) : null,
      graceEndsMs: sub.grace_ends_at ? Date.parse(sub.grace_ends_at) : null
    },
    now
  );

  const data: BillingDetailData = {
    userId,
    canManage,
    canManagePlan,
    user: {
      name: profileRes.data?.full_name ?? "Account unavailable",
      username: profileRes.data?.username ?? null,
      avatarUrl: profileRes.data?.avatar_url ?? null
    },
    subscription: {
      plan: sub.plan,
      effectivePlan: effective,
      status: sub.status,
      provider: sub.provider ?? "paystack",
      currentPeriodStart: sub.current_period_start,
      currentPeriodEnd: sub.current_period_end,
      graceEndsAt: sub.grace_ends_at,
      trialEndsAt: sub.trial_ends_at,
      cancelAtPeriodEnd: sub.cancel_at_period_end,
      subscriptionCode: sub.paystack_subscription_code,
      customerCode: sub.paystack_customer_code,
      updatedAt: sub.updated_at
    },
    changes: (changesRes.data ?? []).map((change) => ({
      id: change.id,
      changeType: change.change_type,
      fromPlan: change.from_plan,
      toPlan: change.to_plan,
      status: change.status,
      effectiveAt: change.effective_at,
      requestedAt: change.requested_at,
      reason: change.reason
    })),
    overrides: (overridesRes.data ?? [])
      .filter((override) => !override.ends_at || Date.parse(override.ends_at) > now)
      .map((override) => ({
        id: override.id,
        key: override.entitlement_key,
        label: entitlementLabel(override.entitlement_key),
        value: override.value_type === "boolean" ? Boolean(override.boolean_value) : override.integer_value,
        reason: override.reason,
        endsAt: override.ends_at
      }))
  };

  return (
    <div className="space-y-5">
      <Link href={"/admin/billing" as Route} className="focus-ring inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back to billing
      </Link>
      <BillingDetailPanel data={data} />
    </div>
  );
}
