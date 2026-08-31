import Link from "next/link";
import type { ReactNode } from "react";
import { BrandSymbol } from "@/components/brand/brand-symbol";

export function FailurePage({
  eyebrow,
  title,
  description,
  children
}: {
  eyebrow: string;
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <main className="relative flex min-h-[100svh] min-h-[100dvh] items-center justify-center overflow-x-hidden bg-[#FEFBF3] px-4 pb-[max(2rem,env(safe-area-inset-bottom))] pt-[max(2rem,env(safe-area-inset-top))] text-[#311712] sm:px-6 dark:bg-[#100807] dark:text-[#FFF8F1]">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[28rem] bg-[radial-gradient(circle_at_50%_0%,rgba(232,140,43,0.18),transparent_58%)] dark:bg-[radial-gradient(circle_at_50%_0%,rgba(232,140,43,0.12),transparent_58%)]" aria-hidden="true" />
      <section className="relative w-full max-w-xl text-center">
        <Link href="/" className="focus-ring mx-auto inline-flex min-h-11 items-center gap-2.5 rounded-xl font-semibold" aria-label="Mad Buddy home">
          <BrandSymbol className="h-9 w-9" priority />
          Mad Buddy
        </Link>
        <p className="mt-10 text-xs font-bold uppercase tracking-[0.18em] text-[#A45A18]">{eyebrow}</p>
        <h1 className="mt-3 text-4xl font-semibold tracking-[-0.04em] text-[#4E0401] sm:text-5xl dark:text-[#FFF8F1]">{title}</h1>
        <p className="mx-auto mt-5 max-w-lg text-sm leading-7 text-[#4E0401]/62 dark:text-[#FFF8F1]/62">{description}</p>
        {children ? <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">{children}</div> : null}
      </section>
    </main>
  );
}
