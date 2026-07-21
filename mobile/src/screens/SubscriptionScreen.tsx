import { useEffect, useState } from "react";
import { Crown, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { Screen } from "../components/AppShell";
import { Spinner } from "../components/Spinner";
import { api } from "../lib/api";
import { env } from "../lib/env";

type Access = { plan: "free" | "buddy_plus" | "buddy_pro"; status: string; hasPremium: boolean };

const planLabels: Record<Access["plan"], string> = {
  free: "Free",
  buddy_plus: "Buddy Plus",
  buddy_pro: "Buddy Pro"
};

const tiers: { id: Access["plan"]; label: string; blurb: string; features: string[] }[] = [
  {
    id: "free",
    label: "Free",
    blurb: "The essentials",
    features: ["Glow & nearby Muddies", "Plans & RSVPs", "Messages & moments", "Safe Arrival"]
  },
  {
    id: "buddy_plus",
    label: "Buddy Plus",
    blurb: "More reach",
    features: ["Everything in Free", "Unlimited circles", "Recurring plans", "Bigger groups & moments"]
  },
  {
    id: "buddy_pro",
    label: "Buddy Pro",
    blurb: "The full experience",
    features: ["Everything in Plus", "Event QR check-in", "Best Buddy & meeting pings", "Priority everything"]
  }
];

export function SubscriptionScreen() {
  const [access, setAccess] = useState<Access | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      const result = await api.get<Access>("/api/subscription");
      setLoading(false);
      if (result.ok) setAccess(result.data);
    })();
  }, []);

  return (
    <Screen title="Plan & billing">
      {loading ? (
        <div className="flex justify-center py-10">
          <Spinner />
        </div>
      ) : (
        <div className="space-y-5">
          <section className="glass-panel rounded-2xl p-5">
            <div className="flex items-center gap-2">
              <Crown className="h-5 w-5 text-primary" aria-hidden="true" />
              <h2 className="text-lg font-semibold">
                {access ? planLabels[access.plan] : "Free"}
              </h2>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {access?.hasPremium ? `Your plan is ${access.status}.` : "You're on the free plan."}
            </p>
          </section>

          <div className="space-y-3">
            {tiers.map((tier) => {
              const current = access?.plan === tier.id;
              return (
                <section
                  key={tier.id}
                  className={cn(
                    "rounded-2xl border p-4",
                    current ? "border-primary bg-primary/5" : "border-border bg-card/40"
                  )}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-base font-semibold">{tier.label}</p>
                      <p className="text-xs text-muted-foreground">{tier.blurb}</p>
                    </div>
                    {current ? (
                      <span className="rounded-full bg-primary/15 px-2.5 py-0.5 text-xs font-medium text-primary">
                        Current
                      </span>
                    ) : null}
                  </div>
                  <ul className="mt-3 space-y-1.5">
                    {tier.features.map((feature) => (
                      <li key={feature} className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Check className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                        {feature}
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })}
          </div>

          <p className="rounded-xl border border-border bg-card/40 p-4 text-center text-xs leading-6 text-muted-foreground">
            Manage or upgrade your subscription on the web at{" "}
            <span className="text-foreground">{env.apiBaseUrl.replace(/^https?:\/\//, "")}/upgrade</span>.
          </p>
        </div>
      )}
    </Screen>
  );
}
