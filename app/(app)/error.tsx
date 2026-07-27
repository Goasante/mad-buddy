"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";

export default function AppError({
  error,
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[app] route render failed", {
      digest: error.digest ?? "unavailable"
    });
  }, [error]);

  return (
    <main className="mx-auto flex w-full max-w-xl flex-col items-center px-6 py-16 text-center">
      <h1 className="text-2xl font-semibold">This page could not be opened</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Your data is safe. Check your connection, then try again.
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <Button type="button" onClick={reset}>
          Try again
        </Button>
        <Button type="button" variant="outline" onClick={() => window.location.assign("/dashboard")}>
          Go to Home
        </Button>
      </div>
    </main>
  );
}
