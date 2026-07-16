import { CalendarClock, CreditCard, ShieldCheck } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const planLabels = {
  free: "Free",
  buddy_plus: "Buddy Plus",
  buddy_pro: "Buddy Pro"
} as const;

export async function SubscriptionStatus() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  const { data: subscription } = user
    ? await supabase
        .from("subscriptions")
        .select("plan, status, current_period_end")
        .eq("user_id", user.id)
        .maybeSingle()
    : { data: null };

  const plan = subscription?.plan ?? "free";
  const status = subscription?.status ?? "free";
  const renewalDate = subscription?.current_period_end
    ? new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(new Date(subscription.current_period_end))
    : "None";

  return (
    <Card className="p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <Badge variant={plan === "free" ? "green" : "violet"}>{status}</Badge>
          <h2 className="mt-4 text-2xl font-semibold">Current plan: {planLabels[plan]}</h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Premium feature writes are checked on the backend before they save.
          </p>
        </div>
        <div className="grid gap-3 text-sm">
          <StatusLine icon={CreditCard} label="Subscription status" value={status} />
          <StatusLine icon={CalendarClock} label="Renewal date" value={renewalDate} />
          <StatusLine icon={ShieldCheck} label="Premium enforcement" value="Backend active" />
        </div>
      </div>
    </Card>
  );
}

type StatusLineProps = {
  icon: typeof CreditCard;
  label: string;
  value: string;
};

function StatusLine({ icon: Icon, label, value }: StatusLineProps) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-md bg-white/[0.05] p-3">
      <div className="flex items-center gap-2 text-muted-foreground">
        <Icon className="h-4 w-4 text-accent" aria-hidden="true" />
        <span>{label}</span>
      </div>
      <span className="font-semibold">{value}</span>
    </div>
  );
}
