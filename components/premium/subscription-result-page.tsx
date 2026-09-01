import Link from "next/link";
import { CheckCircle2, CircleX } from "lucide-react";
import { BrandSymbol } from "@/components/brand/brand-symbol";

export type SubscriptionResultPageProps = {
  type: "success" | "cancelled";
  verified?: boolean;
  message?: string;
};

/** Historical payment-return surface, converged onto the single Mad Buddy Access product. */
export function SubscriptionResultPage({ type, verified = false, message }: SubscriptionResultPageProps) {
  const isSuccess = type === "success";

  return (
    <main className="relative flex min-h-[100svh] min-h-[100dvh] items-center justify-center overflow-x-hidden bg-[#FEFBF3] px-4 pb-[max(2rem,env(safe-area-inset-bottom))] pt-[max(2rem,env(safe-area-inset-top))] text-[#311712] sm:px-6 dark:bg-[#100807] dark:text-[#FFF8F1]">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[30rem] bg-[radial-gradient(circle_at_50%_0%,rgba(232,140,43,0.18),transparent_58%)] dark:bg-[radial-gradient(circle_at_50%_0%,rgba(232,140,43,0.12),transparent_58%)]" aria-hidden="true" />
      <section className="relative w-full max-w-xl text-center">
        <Link href="/" className="focus-ring mx-auto inline-flex min-h-11 items-center gap-2.5 rounded-xl font-semibold" aria-label="Mad Buddy home">
          <BrandSymbol className="h-9 w-9" priority />
          Mad Buddy
        </Link>

        <span className="mx-auto mt-10 grid h-12 w-12 place-items-center rounded-full bg-[#E88C2B]/12 text-[#A45A18]">
          {isSuccess ? <CheckCircle2 className="h-6 w-6" aria-hidden="true" /> : <CircleX className="h-6 w-6" aria-hidden="true" />}
        </span>
        <p className="mt-5 text-xs font-bold uppercase tracking-[0.18em] text-[#A45A18]">Mad Buddy Access</p>
        <h1 className="mt-3 text-4xl font-semibold tracking-[-0.04em] text-[#4E0401] sm:text-5xl dark:text-[#FFF8F1]">
          {isSuccess ? "Payment received." : "Access checkout cancelled."}
        </h1>
        <p className="mx-auto mt-5 max-w-lg text-sm leading-7 text-[#4E0401]/62 dark:text-[#FFF8F1]/62">
          {message ??
            (isSuccess
              ? verified
                ? "Your Paystack payment was verified and Mad Buddy Access was updated."
                : "Your Paystack checkout completed. Mad Buddy is still verifying the Access result server-side."
              : "No Access change was made. You can return to Mad Buddy or retry Access when you are ready.")}
        </p>

        <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
          <Link prefetch={false} href="/dashboard" className="focus-ring inline-flex min-h-11 items-center justify-center rounded-full bg-[#4E0401] px-5 text-sm font-semibold text-white dark:bg-[#E88C2B] dark:text-[#2A120A]">
            Return to Mad Buddy
          </Link>
          <Link prefetch={false} href="/settings/access" className="focus-ring inline-flex min-h-11 items-center justify-center rounded-full border border-[#4E0401]/15 px-5 text-sm font-semibold text-[#4E0401] dark:border-white/15 dark:text-[#FFF8F1]">
            {isSuccess ? "View Access" : "Retry Access"}
          </Link>
        </div>
      </section>
    </main>
  );
}
