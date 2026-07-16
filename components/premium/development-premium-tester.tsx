"use client";

import { FlaskConical } from "lucide-react";
import { useState, useTransition } from "react";
import {
  setDevelopmentPlanAction,
  type DevelopmentPlanState
} from "@/app/(billing)/dev-premium-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const plans = [
  { label: "Free", value: "free" },
  { label: "Buddy Plus", value: "buddy_plus" },
  { label: "Buddy Pro", value: "buddy_pro" }
] as const;

const readyState: DevelopmentPlanState = {
  ok: true,
  message: "Pick a local test plan, then try the premium controls below."
};

export function DevelopmentPremiumTester() {
  const [result, setResult] = useState<DevelopmentPlanState>(readyState);
  const [isPending, startTransition] = useTransition();

  function switchPlan(plan: (typeof plans)[number]["value"]) {
    startTransition(async () => {
      setResult(await setDevelopmentPlanAction(plan));
    });
  }

  return (
    <section className="rounded-lg border border-amber-300/25 bg-amber-300/10 p-4">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <Badge variant="warning">
            <FlaskConical className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
            Local tester
          </Badge>
          <p className="mt-3 text-sm leading-6 text-amber-50/90">{result.message}</p>
        </div>
        <div className="grid gap-2 sm:grid-cols-3">
          {plans.map((plan) => (
            <Button
              key={plan.value}
              type="button"
              variant={plan.value === "buddy_pro" ? "primary" : "outline"}
              disabled={isPending}
              onClick={() => switchPlan(plan.value)}
            >
              {plan.label}
            </Button>
          ))}
        </div>
      </div>
    </section>
  );
}
