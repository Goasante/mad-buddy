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
  /**
   * Which payment method the single-button (labelled) form starts.
   *
   * Defaults to "card", matching every call site that predates this prop.
   * Set explicitly for a single-button re-purchase/renew action whose label
   * names one specific method (e.g. "Renew with Mobile Money") — without
   * this the button would always start a card checkout regardless of what
   * its own label says, which is exactly the kind of mismatch this screen
   * exists to eliminate.
   */
  method?: "mobile_money" | "card";
};

type PaymentMethod = "mobile_money" | "card";

export function CheckoutButton({ plan, label, variant = "primary", className, method = "card" }: CheckoutButtonProps) {
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
          onClick={() => startCheckout(method)}
        >
          {isPending ? (
            <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
          ) : method === "mobile_money" ? (
            <Smartphone className="h-4 w-4" aria-hidden="true" />
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
      <div className="grid gap-2.5 sm:grid-cols-2">
        <button
          type="button"
          disabled={isPending}
          onClick={() => startCheckout("mobile_money")}
          className="focus-ring group flex min-h-[44px] items-center gap-3 rounded-2xl border border-[#E88C2B]/35 bg-[#E88C2B]/10 p-3 text-left transition hover:border-[#E88C2B]/60 hover:bg-[#E88C2B]/15 disabled:cursor-wait disabled:opacity-60"
        >
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#4E0401] text-[#FEFBF3]">
            {pendingMethod === "mobile_money" ? (
              <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
            ) : (
              <Smartphone className="h-4 w-4" aria-hidden="true" />
            )}
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5">
              <span className="block text-sm font-semibold">Mobile Money</span>
              {/* Quiet contextual label, not a status pill -- it only clarifies
                  where this payment channel works, so it must never compete
                  visually with the payment method name or read as an account
                  state the way the emerald "Access active" badge does. */}
              <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[#4E0401]/60 dark:text-[#F0AE68]/70">
                Ghana
              </span>
            </span>
            <span className="mt-0.5 block truncate text-xs leading-5 text-muted-foreground">MTN MoMo · AT Money · Telecel</span>
            <span className="mt-0.5 block text-xs font-medium text-foreground">GHS 4.99 · 30 days · no auto-renew</span>
          </span>
        </button>

        <button
          type="button"
          disabled={isPending}
          onClick={() => startCheckout("card")}
          className="focus-ring flex min-h-[44px] items-center gap-3 rounded-2xl border border-border bg-card/70 p-3 text-left transition hover:border-foreground/20 hover:bg-card disabled:cursor-wait disabled:opacity-60"
        >
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-secondary text-foreground">
            {pendingMethod === "card" ? (
              <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
            ) : (
              <CreditCard className="h-4 w-4" aria-hidden="true" />
            )}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold">Card</span>
            <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">Visa or Mastercard</span>
            <span className="mt-0.5 block text-xs font-medium text-foreground">GHS 4.99 / month · auto-renews</span>
          </span>
        </button>
      </div>
      <p className="mt-2 text-[11px] leading-5 text-muted-foreground">
        Mobile Money is a manual 30-day payment. Card renews monthly until you cancel.
      </p>
      {message ? <p className="mt-2 text-xs leading-5 text-amber-700 dark:text-amber-100">{message}</p> : null}
    </div>
  );
}
