"use client";

import { ExternalLink, Loader2, XCircle } from "lucide-react";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";

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
  const [isPending, startTransition] = useTransition();

  function openPortal() {
    startTransition(async () => {
      setMessage(null);
      setMessage(
        icon === "cancel"
          ? "Paystack cancellation will be handled from the Paystack dashboard for now. Contact support to cancel safely."
          : "Paystack does not provide a hosted customer portal here yet. Subscription management is handled by support for now."
      );
    });
  }

  const Icon = icon === "cancel" ? XCircle : ExternalLink;

  return (
    <div>
      <Button type="button" variant={variant} className="w-full" disabled={isPending} onClick={openPortal}>
        {isPending ? (
          <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
        ) : (
          <Icon className="h-4 w-4" aria-hidden="true" />
        )}
        {label}
      </Button>
      {message ? (
        <p className="mt-2 text-xs leading-5 text-amber-700 dark:text-amber-100">{message}</p>
      ) : null}
    </div>
  );
}
