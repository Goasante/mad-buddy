"use client";

import { RefreshCcw, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function GlobalError({
  error,
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-16 text-foreground">
      <section className="glass-panel w-full max-w-md rounded-[1.35rem] p-8 text-center">
        <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-amber-400/10 text-amber-600 dark:text-amber-300">
          <TriangleAlert className="h-6 w-6" aria-hidden="true" />
        </span>
        <h1 className="mt-5 text-2xl font-semibold tracking-tight">Something went wrong.</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          The page hit an unexpected error. Your data is safe — nothing was lost. Retrying is
          safe, and if it keeps happening, going home usually clears it.
        </p>
        {error.digest ? (
          <p className="mt-2 text-xs text-muted-foreground">Error reference: {error.digest}</p>
        ) : null}
        <div className="mt-6 flex flex-col justify-center gap-3 sm:flex-row">
          <Button type="button" onClick={reset}>
            <RefreshCcw className="h-4 w-4" aria-hidden="true" />
            Try again
          </Button>
          <Button asChild variant="outline">
            <Link href="/">Go home</Link>
          </Button>
        </div>
      </section>
    </main>
  );
}
