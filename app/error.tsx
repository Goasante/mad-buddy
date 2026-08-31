"use client";

import Link from "next/link";
import { RefreshCcw } from "lucide-react";
import { FailurePage } from "@/components/front-door/failure-page";

export default function GlobalError({
  error,
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <FailurePage
      eyebrow="Something went wrong"
      title="Mad Buddy couldn't finish this page."
      description="Try the page again. If the problem keeps happening, return home or contact Support and include the error reference if one is shown."
    >
      <button
        type="button"
        onClick={reset}
        className="focus-ring inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-[#4E0401] px-5 text-sm font-semibold text-white dark:bg-[#E88C2B] dark:text-[#2A120A]"
      >
        <RefreshCcw className="h-4 w-4" aria-hidden="true" />
        Try again
      </button>
      <Link href="/support" className="focus-ring inline-flex min-h-11 items-center justify-center rounded-full border border-[#4E0401]/15 px-5 text-sm font-semibold text-[#4E0401] dark:border-white/15 dark:text-[#FFF8F1]">
        Support{error.digest ? ` · ${error.digest}` : ""}
      </Link>
    </FailurePage>
  );
}
