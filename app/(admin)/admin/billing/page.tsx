import { CircleDollarSign, CreditCard, UserRoundCheck, WalletCards } from "lucide-react";
import { AdminEmptyState, AdminMetricCard, AdminPageHeader, AdminQueryError, AdminSection, AdminStatus, formatAdminDate, humanizeAdminValue } from "@/components/admin/admin-ui";
import { Card } from "@/components/ui/card";
import { requireAdminPagePermission } from "@/lib/admin/access";

export default async function AdminBillingPage() {
  const { admin } = await requireAdminPagePermission("admin.billing.view");
  const [subscriptionsResult, profilesResult] = await Promise.all([
    admin.from("subscriptions").select("user_id, provider, plan, status, current_period_end, updated_at").order("updated_at", { ascending: false }).limit(100),
    admin.from("profiles").select("user_id, full_name, username")
  ]);
  const subscriptions = subscriptionsResult.data ?? [];
  const labels = new Map((profilesResult.data ?? []).map((profile) => [profile.user_id, profile.full_name || `@${profile.username}`]));
  const active = subscriptions.filter((item) => ["active", "trialing"].includes(item.status));

  return (
    <div className="space-y-7">
      <AdminPageHeader title="Billing" description="Monitor Paystack subscription state without exposing payment credentials or raw transaction details." />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <AdminMetricCard icon={UserRoundCheck} label="Active premium" value={active.length} hint="Active and trialing accounts" tone="success" />
        <AdminMetricCard icon={WalletCards} label="Buddy Plus" value={active.filter((item) => item.plan === "buddy_plus").length} hint="Current premium accounts" tone="orange" />
        <AdminMetricCard icon={CircleDollarSign} label="Buddy Pro" value={active.filter((item) => item.plan === "buddy_pro").length} hint="Current premium accounts" tone="orange" />
        <AdminMetricCard icon={CreditCard} label="Needs attention" value={subscriptions.filter((item) => item.status === "past_due").length} hint="Past due subscriptions" tone={subscriptions.some((item) => item.status === "past_due") ? "warning" : "success"} />
      </div>
      <AdminSection title="Recent subscription records" description="Latest plan and lifecycle state reported by the billing integration.">
        {subscriptionsResult.error || profilesResult.error ? <AdminQueryError /> : null}
        {!subscriptionsResult.error && subscriptions.length === 0 ? <AdminEmptyState icon={CreditCard} title="No subscriptions" description="Subscription records will appear after a plan is started." /> : null}
        {subscriptions.length ? (
          <Card className="overflow-x-auto p-0">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="border-b border-border/70 text-xs text-muted-foreground"><tr><th className="px-4 py-3 font-medium">Account</th><th className="px-4 py-3 font-medium">Plan</th><th className="px-4 py-3 font-medium">Status</th><th className="px-4 py-3 font-medium">Provider</th><th className="px-4 py-3 font-medium">Period end</th><th className="px-4 py-3 text-right font-medium">Updated</th></tr></thead>
              <tbody className="divide-y divide-border/70">
                {subscriptions.map((item) => <tr key={`${item.user_id}-${item.updated_at}`}><td className="max-w-64 truncate px-4 py-3.5 font-medium">{labels.get(item.user_id) ?? "Account unavailable"}</td><td className="px-4 py-3.5">{humanizeAdminValue(item.plan)}</td><td className="px-4 py-3.5"><AdminStatus label={humanizeAdminValue(item.status)} tone={item.status === "active" ? "success" : item.status === "past_due" ? "warning" : "default"} /></td><td className="px-4 py-3.5 text-muted-foreground">{humanizeAdminValue(item.provider ?? "paystack")}</td><td className="px-4 py-3.5 text-muted-foreground">{formatAdminDate(item.current_period_end)}</td><td className="px-4 py-3.5 text-right text-muted-foreground">{formatAdminDate(item.updated_at, true)}</td></tr>)}
              </tbody>
            </table>
          </Card>
        ) : null}
      </AdminSection>
    </div>
  );
}
