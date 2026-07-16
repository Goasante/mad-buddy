import Link from "next/link";
import { CheckCircle2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export type SubscriptionResultPageProps = {
  type: "success" | "cancelled";
  verified?: boolean;
  message?: string;
};

export function SubscriptionResultPage({ type, verified = false, message }: SubscriptionResultPageProps) {
  const isSuccess = type === "success";

  return (
    <main className="flex min-h-screen items-center justify-center px-6 py-12">
      <Card className="w-full max-w-lg p-6 text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-white/[0.08]">
          {isSuccess ? (
            <CheckCircle2 className="h-7 w-7 text-accent" aria-hidden="true" />
          ) : (
            <XCircle className="h-7 w-7 text-amber-200" aria-hidden="true" />
          )}
        </div>
        <h1 className="mt-5 text-2xl font-semibold">
          {isSuccess ? "Subscription activated" : "Subscription cancelled"}
        </h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          {message ??
            (isSuccess
              ? verified
                ? "Your Paystack payment was verified server-side and your plan has been updated."
                : "Your Paystack checkout completed. Webhook sync will update your plan shortly."
              : "No plan change was made. You can retry the upgrade anytime.")}
        </p>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center">
          <Button type="button" asChild>
            <Link href="/dashboard">Return to dashboard</Link>
          </Button>
          {!isSuccess ? (
            <Button type="button" variant="outline" asChild>
              <Link href="/upgrade">Retry upgrade</Link>
            </Button>
          ) : null}
        </div>
      </Card>
    </main>
  );
}
