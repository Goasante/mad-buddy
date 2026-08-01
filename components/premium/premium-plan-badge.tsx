import { Crown, Sparkles } from "lucide-react";
import { premiumBadgeIdentity } from "@/lib/billing/premium-identity";
import type { SubscriptionPlan } from "@/lib/supabase/database.types";
import { cn } from "@/lib/utils";

export function PremiumPlanBadge({
  plan,
  compact = false,
  className
}: {
  plan: SubscriptionPlan | null | undefined;
  compact?: boolean;
  className?: string;
}) {
  const identity = premiumBadgeIdentity(plan);
  if (!identity) return null;

  const Icon = identity.tier === "pro" ? Crown : Sparkles;

  return (
    <span
      className={cn(
        "premium-plan-badge inline-flex h-5 shrink-0 items-center gap-1 rounded-full border px-1.5 text-[10px] font-bold leading-none tracking-wide",
        identity.tier === "pro"
          ? "premium-plan-badge--pro border-orange-400/45 bg-orange-400/10 text-orange-700 dark:text-orange-200"
          : "border-indigo-400/40 bg-indigo-400/10 text-indigo-700 dark:text-indigo-200",
        className
      )}
      title={`${identity.label} member`}
      aria-label={`${identity.label} member`}
    >
      <Icon className="h-3 w-3" aria-hidden="true" />
      <span>{compact ? identity.shortLabel : identity.label}</span>
    </span>
  );
}

