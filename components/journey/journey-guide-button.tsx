"use client";

import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { RotateCcw } from "lucide-react";
import { startTourReplayAction } from "@/app/(app)/tour-replay-actions";

export function JourneyGuideButton({ tourVersionId, destination, label, compact = false }: { tourVersionId: string; destination: string; label: string; compact?: boolean }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  function replay() {
    setError("");
    startTransition(async () => {
      const result = await startTourReplayAction({ versionId: tourVersionId });
      if (!result.ok) { setError(result.message); return; }
      router.push(destination as Route);
    });
  }
  // Compact: an icon-only tertiary control for a completed step row, so the
  // capability stays reachable without a text label repeating on every row.
  if (compact) {
    return (
      <div className="shrink-0">
        <button
          type="button"
          disabled={pending}
          onClick={replay}
          className="focus-ring grid h-11 w-11 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-secondary/50 hover:text-foreground"
          aria-label={`Replay ${label} guide`}
          title="Replay guide"
        >
          <RotateCcw className="h-4 w-4" aria-hidden="true" />
        </button>
        {error ? <p className="mt-1 max-w-40 text-xs text-destructive" role="alert">{error}</p> : null}
      </div>
    );
  }
  return <div className="shrink-0 text-right"><button type="button" disabled={pending} onClick={replay} className="focus-ring inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-semibold text-muted-foreground hover:bg-secondary/50 hover:text-foreground" aria-label={`Replay ${label} guide`}><RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />{pending ? "Starting..." : "Replay guide"}</button>{error ? <p className="mt-1 max-w-40 text-xs text-destructive" role="alert">{error}</p> : null}</div>;
}
