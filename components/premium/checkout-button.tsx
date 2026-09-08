"use client";

import { CreditCard, Loader2, Smartphone } from "lucide-react";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import type { PaidPlanId } from "@/lib/paystack/config";
import { fetchWithTimeout } from "@/lib/network/resilience";

export type CheckoutButtonProps = {
  /** Deprecated compatibility prop. Consumer checkout no longer selects Plus/Pro. */
  plan?: PaidPlanId;
  label?: string;
  variant?: "primary" | "outline";
  className?: string;
};

type PaymentMethod = "mobile_money" | "card";

export function CheckoutButton({ plan, label, variant = "primary", className }: CheckoutButtonProps) {
  const [message, setMessage] = useState<string | null>(null);
  const [pendingMethod, setPendingMethod] = useState<PaymentMethod | null>(null);
  const [isPending, startTransition] = useTransition();
  const showPaymentChooser = !plan && !label;

  function startCheckout(paymentMethod: PaymentMethod) {
    setPendingMethod(paymentMethod);
    startTransition(async () => {
      setMessage(null);
      try {
        const response = await fetchWithTimeout(
          "/api/access/checkout",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ product: "mad_buddy_access", paymentMethod })
          },
          20_000,
          "start Mad Buddy Access checkout"
        );
        if (response.status === 401) {
          window.location.assign(`/login?next=${encodeURIComponent("/settings/access")}`);
          return;
        }
        const data = (await response.json()) as { authorizationUrl?: string; error?: string };
        if (!response.ok || !data.authorizationUrl) {
          setMessage(data.error ?? "Could not start checkout.");
          return;
        }
        window.location.assign(data.authorizationUrl);
      } catch {
        setMessage("Checkout could not be reached. Check your connection and try again.");
      } finally {
        setPendingMethod(null);
      }
    });
  }

  if (!showPaymentChooser) {
    return (
      <div className={className}>
        <Button
          type="button"
          className="w-full"
          variant={variant}
          disabled={isPending}
          onClick={() => startCheckout("card")}
        >
          {isPending ? (
            <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
          ) : (
            <CreditCard className="h-4 w-4" aria-hidden="true" />
          )}
          {label ?? "Get Mad Buddy Access"}
        </Button>
        {message ? <p className="mt-2 text-xs leading-5 text-amber-700 dark:text-amber-100">{message}</p> : null}
      </div>
    );
  }

  return (
    <div className={className}>
      <div className="grid gap-3 sm:grid-cols-2">
        <button
          type="button"
          disabled={isPending}
          onClick={() => startCheckout("mobile_money")}
          className="focus-ring group min-h-[5.75rem] rounded-2xl border border-[#E88C2B]/35 bg-[#E88C2B]/10 p-4 text-left transition hover:border-[#E88C2B]/60 hover:bg-[#E88C2B]/15 disabled:cursor-wait disabled:opacity-60"
        >
          <span className="flex items-center justify-between gap-3">
            <span className="grid h-9 w-9 place-items-center rounded-full bg-[#4E0401] text-[#FEFBF3]">
              {pendingMethod === "mobile_money" ? (
                <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
              ) : (
                <Smartphone className="h-4 w-4" aria-hidden="true" />
              )}
            </span>
            <span className="rounded-full bg-[#FEFBF3]/80 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#4E0401] dark:bg-background/70 dark:text-foreground">
              Ghana
            </span>
          </span>
          <span className="mt-3 block text-sm font-semibold">Mobile Money</span>
          <span className="mt-1 block text-xs leading-5 text-muted-foreground">MTN MoMo · AT Money · Telecel</span>
          <span className="mt-1 block text-xs font-medium text-foreground">GHS 5.00 · 30 days · no auto-renew</span>
        </button>

        <button
          type="button"
          disabled={isPending}
          onClick={() => startCheckout("card")}
          className="focus-ring min-h-[5.75rem] rounded-2xl border border-border bg-card/70 p-4 text-left transition hover:border-foreground/20 hover:bg-card disabled:cursor-wait disabled:opacity-60"
        >
          <span className="grid h-9 w-9 place-items-center rounded-full bg-secondary text-foreground">
            {pendingMethod === "card" ? (
              <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
            ) : (
              <CreditCard className="h-4 w-4" aria-hidden="true" />
            )}
          </span>
          <span className="mt-3 block text-sm font-semibold">Card</span>
          <span className="mt-1 block text-xs leading-5 text-muted-foreground">Visa or Mastercard</span>
          <span className="mt-1 block text-xs font-medium text-foreground">GHS 5.00 / month · auto-renews</span>
        </button>
      </div>
      <p className="mt-2 text-[11px] leading-5 text-muted-foreground">
        Mobile Money is a manual 30-day payment. Card renews monthly until you cancel.
      </p>
      {message ? <p className="mt-2 text-xs leading-5 text-amber-700 dark:text-amber-100">{message}</p> : null}
    </div>
  );
}
