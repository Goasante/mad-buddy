import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import { BrandSymbol } from "@/components/brand/brand-symbol";

export type AuthShellProps = {
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
};

export function AuthShell({ title, description, children, footer }: AuthShellProps) {
  return (
    <main className="relative min-h-[100svh] min-h-[100dvh] overflow-x-hidden bg-[#FEFBF3] px-4 pb-[max(2rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))] text-[#311712] selection:bg-[#E88C2B]/25 selection:text-[#4E0401] sm:px-6 dark:bg-[#100807] dark:text-[#FFF8F1]">
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-[28rem] bg-[radial-gradient(circle_at_50%_0%,rgba(232,140,43,0.18),transparent_58%)] dark:bg-[radial-gradient(circle_at_50%_0%,rgba(232,140,43,0.12),transparent_58%)]"
        aria-hidden="true"
      />

      <div className="relative mx-auto flex w-full max-w-6xl items-center justify-between py-2">
        <Link href="/" className="focus-ring inline-flex min-h-11 items-center gap-2.5 rounded-xl font-semibold" aria-label="Mad Buddy home">
          <BrandSymbol className="h-8 w-8" priority />
          <span>Mad Buddy</span>
        </Link>
        <Link
          href="/"
          className="focus-ring inline-flex min-h-11 items-center gap-2 rounded-full px-3 text-sm font-semibold text-[#4E0401]/60 hover:bg-[#E88C2B]/10 hover:text-[#4E0401] dark:text-[#FFF8F1]/60 dark:hover:bg-white/[0.06] dark:hover:text-[#FFF8F1]"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Home
        </Link>
      </div>

      <div className="relative mx-auto grid w-full max-w-6xl items-start gap-10 pb-10 pt-10 lg:grid-cols-[minmax(0,0.95fr)_minmax(24rem,0.72fr)] lg:gap-20 lg:pb-16 lg:pt-20">
        <section className="hidden max-w-xl lg:block">
          <p className="inline-flex min-h-9 items-center gap-2 rounded-full border border-[#E88C2B]/25 bg-[#E88C2B]/[0.08] px-3.5 text-xs font-bold uppercase tracking-[0.14em] text-[#8E4B12] dark:text-[#F0AE68]">
            <ShieldCheck className="h-4 w-4" aria-hidden="true" />
            Privacy-first social proximity
          </p>
          <h2 className="mt-6 text-5xl font-semibold leading-[1.02] tracking-[-0.045em] text-[#4E0401] dark:text-[#FFF8F1]">
            Connection without broadcasting exactly where you are.
          </h2>
          <p className="mt-5 max-w-lg text-base leading-8 text-[#4E0401]/65 dark:text-[#FFF8F1]/65">
            Mad Buddy uses privacy-safe proximity to help trusted friends notice each other and lets you deliberately enable Linkr when you want to discover someone new.
          </p>
          <ul className="mt-8 grid gap-3 text-sm leading-6 text-[#4E0401]/65 dark:text-[#FFF8F1]/65">
            <li>Exact GPS coordinates are not shown to other users.</li>
            <li>No live map position or exact numerical distance is exposed.</li>
            <li>You decide when visibility and Linkr discovery are active.</li>
          </ul>
        </section>

        <section aria-labelledby="auth-title" className="mx-auto w-full max-w-md lg:mx-0">
          <div className="rounded-[1.75rem] border border-[#4E0401]/10 bg-white/60 p-5 shadow-[0_24px_70px_rgba(78,4,1,0.08)] backdrop-blur sm:p-7 dark:border-white/10 dark:bg-white/[0.035] dark:shadow-[0_24px_70px_rgba(0,0,0,0.24)]">
            <div>
              <h1 id="auth-title" className="text-3xl font-semibold tracking-[-0.035em] text-[#4E0401] dark:text-[#FFF8F1]">
                {title}
              </h1>
              {description ? (
                <p className="mt-3 text-sm leading-6 text-[#4E0401]/60 dark:text-[#FFF8F1]/60">{description}</p>
              ) : null}
            </div>
            <div className="mt-7">{children}</div>
          </div>
          {footer ? <div className="mt-5 text-center text-sm text-[#4E0401]/55 dark:text-[#FFF8F1]/55">{footer}</div> : null}
        </section>
      </div>
    </main>
  );
}
