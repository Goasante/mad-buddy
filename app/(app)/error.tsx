"use client";

import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function AppError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto mt-8 max-w-xl rounded-2xl border border-red-400/30 bg-red-400/10 p-6 text-center" role="alert">
      <AlertTriangle className="mx-auto h-6 w-6 text-red-500" aria-hidden="true" />
      <h1 className="mt-3 text-lg font-semibold">This page could not be loaded</h1>
      <p className="mt-2 text-sm text-muted-foreground">Check your connection and try again.</p>
      <Button type="button" variant="outline" size="sm" className="mt-4" onClick={reset}>Try again</Button>
    </div>
  );
}
