"use client";

import { useState, useTransition } from "react";
import { LoaderCircle, Send } from "lucide-react";
import { sendStaffMessageAction } from "@/app/(admin)/admin/users/actions";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

/**
 * Compose a one-way, non-replyable message to a user. It arrives in their Pulse
 * tagged by the sender's tier (`tag`). Server re-checks the permission and
 * derives the tag from the actual role, so this label is only a preview.
 */
export function AdminUserMessage({ userId, tag }: { userId: string; tag: string }) {
  const [message, setMessage] = useState("");
  const [feedback, setFeedback] = useState("");
  const [pending, startTransition] = useTransition();

  function send() {
    startTransition(async () => {
      const result = await sendStaffMessageAction({ userId, message: message.trim() });
      setFeedback(result.message);
      if (result.ok) setMessage("");
    });
  }

  return (
    <details className="group md:col-span-5">
      <summary className="focus-ring safe-motion flex w-fit cursor-pointer list-none items-center gap-2 rounded-lg px-2 py-1.5 text-xs font-medium text-muted-foreground hover:bg-secondary hover:text-foreground">
        <Send className="h-3.5 w-3.5" aria-hidden="true" />
        Message user
      </summary>
      <div className="mt-3 space-y-2 rounded-xl border border-border/70 bg-secondary/20 p-3">
        <p className="text-[11px] text-muted-foreground">
          Sends as <span className="font-semibold text-foreground">{tag}</span> · appears in their Pulse · the user can&rsquo;t reply.
        </p>
        <Textarea
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          placeholder="Write a short message to this user…"
          maxLength={1000}
          rows={3}
          disabled={pending}
          aria-label="Message to user"
        />
        <div className="flex items-center justify-between gap-3">
          {feedback ? <p className="min-w-0 truncate text-xs text-muted-foreground" role="status">{feedback}</p> : <span />}
          <Button type="button" size="sm" disabled={pending || message.trim().length < 2} onClick={send}>
            {pending ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Send className="h-4 w-4" aria-hidden="true" />}
            Send
          </Button>
        </div>
      </div>
    </details>
  );
}
