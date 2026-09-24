"use client";

import { Loader2 } from "lucide-react";
import { useState, useTransition } from "react";

import { decideAppealAction } from "@/app/(admin)/admin/appeals/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function AppealControls({ appealId }: { appealId: string }) {
  const [note, setNote] = useState("");
  const [feedback, setFeedback] = useState("");
  const [pending, startTransition] = useTransition();
  function decide(decision: "upheld" | "reversed") {
    startTransition(async () => {
      const result = await decideAppealAction({ appealId, decision, note });
      setFeedback(result.message);
      if (result.ok) setNote("");
    });
  }
  return (
    <div className="mt-3 space-y-2 border-t border-border/60 pt-3">
      <Input value={note} onChange={(event) => setNote(event.target.value)} maxLength={1000} placeholder="Decision note" disabled={pending} />
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" disabled={pending || note.trim().length < 3} onClick={() => decide("reversed")}>Approve appeal</Button>
        <Button type="button" size="sm" variant="danger" disabled={pending || note.trim().length < 3} onClick={() => decide("upheld")}>Uphold restriction</Button>
      </div>
      {pending ? <p className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" /> Saving…</p> : null}
      {feedback ? <p className="text-xs text-muted-foreground" role="status">{feedback}</p> : null}
    </div>
  );
}
