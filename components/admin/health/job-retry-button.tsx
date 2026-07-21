"use client";

import { RotateCcw } from "lucide-react";
import { useState, useTransition } from "react";
import { retryJobAction } from "@/app/(admin)/admin/system/actions";
import { Button } from "@/components/ui/button";

export function JobRetryButton({ jobId }: { jobId: string }) {
  const [pending, start] = useTransition();
  const [message, setMessage] = useState("");

  function retry() {
    start(async () => {
      const result = await retryJobAction({ jobId });
      setMessage(result.message);
    });
  }

  return (
    <div className="flex items-center gap-2">
      {message ? <span className="text-[11px] text-muted-foreground" role="status">{message}</span> : null}
      <Button type="button" size="sm" variant="outline" onClick={retry} disabled={pending}>
        <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" /> Requeue
      </Button>
    </div>
  );
}
