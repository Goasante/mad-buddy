"use client";

import { useState, useTransition } from "react";
import { LoaderCircle, RotateCcw } from "lucide-react";
import { retryBroadcastCommunicationAction } from "@/app/(admin)/admin/communications/actions";
import { Button } from "@/components/ui/button";

export function AdminBroadcastRetry({ campaignId }: { campaignId: string }) {
  const [feedback, setFeedback] = useState("");
  const [pending, startTransition] = useTransition();

  function retry() {
    setFeedback("");
    startTransition(async () => {
      const result = await retryBroadcastCommunicationAction({ campaignId });
      setFeedback(result.message);
    });
  }

  return (
    <div className="mt-2">
      <Button type="button" variant="outline" size="sm" disabled={pending} onClick={retry}>
        {pending ? (
          <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
        ) : (
          <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
        )}
        Retry failed
      </Button>
      {feedback ? <p className="mt-1.5 max-w-[260px] text-[10px] leading-4 text-muted-foreground" role="status">{feedback}</p> : null}
    </div>
  );
}
