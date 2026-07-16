"use client";

import { CreditCard, Loader2 } from "lucide-react";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import type { PaidPlanId } from "@/lib/paystack/config";

export type CheckoutButtonProps = {
  plan: PaidPlanId;
  label?: string;
  variant?: "primary" | "outline";
  className?: string;
};

export function CheckoutButton({
  plan,
  label = "Upgrade",
  variant = "primary",
  className
}: CheckoutButtonProps) {
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function startCheckout() {
    startTransition(async () => {
      setMessage(null);
      const response = await fetch("/api/paystack/initialize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan })
      });
      const data = (await response.json()) as { authorizationUrl?: string; error?: string };

      if (!response.ok || !data.authorizationUrl) {
        setMessage(data.error ?? "Could not start checkout.");
        return;
      }

      window.location.href = data.authorizationUrl;
    });
  }

  return (
    <div className={className}>
      <Button type="button" className="w-full" variant={variant} disabled={isPending} onClick={startCheckout}>
        {isPending ? (
          <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
        ) : (
          <CreditCard className="h-4 w-4" aria-hidden="true" />
        )}
        {label}
      </Button>
      {message ? (
        <p className="mt-2 text-xs leading-5 text-amber-700 dark:text-amber-100">{message}</p>
      ) : null}
    </div>
  );
}
