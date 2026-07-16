import { CreditCard } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { SubscriptionPlan, SubscriptionStatus } from "@/lib/supabase/database.types";

const statuses: SubscriptionStatus[] = ["free", "trialing", "active", "past_due", "cancelled", "expired"];
const plans: SubscriptionPlan[] = ["free", "buddy_plus", "buddy_pro"];

export default async function AdminBillingPage() {
  const admin = createSupabaseAdminClient();
  const [subscriptionsResult, profilesResult] = await Promise.all([
    admin
      .from("subscriptions")
        .select("user_id, provider, plan, status, paystack_subscription_code, current_period_end, updated_at")
      .order("updated_at", { ascending: false })
      .limit(50),
    admin.from("profiles").select("user_id, full_name, username")
  ]);

  const subscriptions = subscriptionsResult.data ?? [];
  const labels = new Map(
    (profilesResult.data ?? []).map((profile) => [
      profile.user_id,
      `${profile.full_name} (@${profile.username})`
    ])
  );

  return (
    <div className="space-y-6">
      <section>
        <Badge variant="orange">
          <CreditCard className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
          Billing
        </Badge>
        <h1 className="mt-4 text-3xl font-semibold">Subscription management</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
          Paystack-linked subscription state. Secret keys and raw payment details are never shown here.
        </p>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {plans.map((plan) => (
          <Card key={plan} className="p-4">
            <p className="text-sm text-muted-foreground">{plan}</p>
            <p className="mt-2 text-3xl font-semibold">
              {subscriptions.filter((subscription) => subscription.plan === plan).length}
            </p>
          </Card>
        ))}
      </section>

      <section className="grid gap-3">
        {statuses.map((status) => (
          <div key={status} className="flex items-center justify-between rounded-md border border-white/10 p-3">
            <span className="text-sm text-muted-foreground">{status}</span>
            <span className="font-semibold">
              {subscriptions.filter((subscription) => subscription.status === status).length}
            </span>
          </div>
        ))}
      </section>

      <section className="grid gap-3">
        <h2 className="text-xl font-semibold">Recent subscription records</h2>
        {subscriptions.map((subscription) => (
          <Card key={`${subscription.user_id}-${subscription.updated_at}`} className="p-4">
            <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-center">
              <div className="min-w-0">
                <p className="truncate font-semibold">{labels.get(subscription.user_id) ?? "Unknown user"}</p>
                <p className="mt-1 truncate text-xs text-muted-foreground">
                  {subscription.provider ?? "paystack"} subscription {subscription.paystack_subscription_code ? "linked" : "not linked"}
                </p>
              </div>
              <div className="flex flex-wrap gap-2 md:justify-end">
                <Badge variant={subscription.status === "active" ? "green" : "default"}>{subscription.status}</Badge>
                <Badge variant="orange">{subscription.plan}</Badge>
              </div>
            </div>
          </Card>
        ))}
      </section>
    </div>
  );
}
