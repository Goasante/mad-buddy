"use client";

import { ExternalLink, Loader2, XCircle } from "lucide-react";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { CANCELLATION_REASONS } from "@/lib/revenue/cancellation";
import { fetchWithTimeout } from "@/lib/network/resilience";

type BillingPortalButtonProps = {
  label?: string;
  variant?: "primary" | "outline" | "danger";
  icon?: "external" | "cancel";
};

export function BillingPortalButton({
  label = "Manage billing",
  variant = "outline",
  icon = "external"
}: BillingPortalButtonProps) {
  const [message, setMessage] = useState<string | null>(null);
  const [showCancellation, setShowCancellation] = useState(false);
  const [reason, setReason] = useState("prefer_not_to_say");
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function openPortal() {
    if (icon === "cancel" && !showCancellation) {
      setShowCancellation(true);
      setMessage(null);
      return;
    }
    startTransition(async () => {
      setMessage(null);
      if (icon !== "cancel") {
        setMessage("Paystack does not provide a hosted customer portal here yet. Subscription management is handled by support for now.");
        return;
      }
      try {
        const response = await fetchWithTimeout("/api/paystack/cancel", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason })
        }, 20_000, "schedule subscription cancellation");
        const data = await response.json().catch(() => ({})) as { message?: string; error?: string };
        setMessage(response.ok ? data.message ?? "Cancellation scheduled." : data.error ?? "Cancellation could not be scheduled.");
        if (response.ok) router.refresh();
      } catch {
        setMessage("Cancellation could not be scheduled. Check your connection and try again.");
      }
    });
  }

  const Icon = icon === "cancel" ? XCircle : ExternalLink;

  return (
    <div>
      {icon === "cancel" && showCancellation ? (
        <div className="mb-3 space-y-2 rounded-xl border border-border/70 bg-secondary/35 p-3">
          <label className="block text-xs font-medium" htmlFor="cancellation-reason">Why are you leaving? <span className="text-muted-foreground">(optional)</span></label>
          <select id="cancellation-reason" value={reason} onChange={(event) => setReason(event.target.value)} className="focus-ring h-10 w-full rounded-lg border border-border bg-background px-3 text-sm">
            {CANCELLATION_REASONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
        </div>
      ) : null}
      <Button type="button" variant={variant} className="w-full" disabled={isPending} onClick={openPortal}>
        {isPending ? (
          <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
        ) : (
          <Icon className="h-4 w-4" aria-hidden="true" />
        )}
        {icon === "cancel" && showCancellation ? "Confirm cancellation" : label}
      </Button>
      {message ? (
        <p className="mt-2 text-xs leading-5 text-amber-700 dark:text-amber-100">{message}</p>
      ) : null}
    </div>
  );
}
