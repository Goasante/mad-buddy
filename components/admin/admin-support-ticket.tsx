"use client";

import { useState, useTransition } from "react";
import { LoaderCircle, Send } from "lucide-react";
import { replyToSupportTicketAction } from "@/app/(admin)/admin/actions";
import { AdminQueueStatus } from "@/components/admin/admin-queue-status";
import { Button } from "@/components/ui/button";

export type AdminSupportMessage = {
  id: string;
  senderType: string;
  message: string;
  createdAt: string;
};

export function AdminSupportTicket({ ticketId, status, description, messages }: { ticketId: string; status: string; description: string; messages: AdminSupportMessage[] }) {
  const [reply, setReply] = useState("");
  const [feedback, setFeedback] = useState("");
  const [pending, startTransition] = useTransition();

  function send() {
    startTransition(async () => {
      const result = await replyToSupportTicketAction({ ticketId, message: reply });
      setFeedback(result.message);
      if (result.ok) setReply("");
    });
  }

  return (
    <details className="group border-t border-border/70 pt-3">
      <summary className="focus-ring safe-motion w-fit cursor-pointer list-none rounded-lg px-2 py-1.5 text-xs font-medium text-primary hover:bg-primary/10">Open complaint</summary>
      <div className="mt-3 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.55fr)]">
        <div className="space-y-3">
          <div className="rounded-xl bg-secondary/35 p-3"><p className="text-xs font-semibold">User message</p><p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-muted-foreground">{description}</p></div>
          {messages.map((item) => <div key={item.id} className="rounded-xl border border-border/70 p-3"><p className="text-xs font-semibold">{item.senderType === "agent" ? "Admin reply" : "User reply"}</p><p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-muted-foreground">{item.message}</p><time className="mt-2 block text-[11px] text-muted-foreground">{new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(new Date(item.createdAt))}</time></div>)}
        </div>
        <div className="space-y-3">
          <AdminQueueStatus kind="support" recordId={ticketId} initialStatus={status} />
          <label className="block text-xs font-semibold" htmlFor={`reply-${ticketId}`}>Reply to user</label>
          <textarea id={`reply-${ticketId}`} value={reply} onChange={(event) => setReply(event.target.value)} maxLength={2000} rows={4} placeholder="Write a clear support response" className="focus-ring w-full resize-y rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none placeholder:text-muted-foreground" />
          <Button type="button" size="sm" disabled={pending || reply.trim().length < 2} onClick={send}>
            {pending ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Send className="h-4 w-4" aria-hidden="true" />}
            Send reply
          </Button>
          {feedback ? <p className="text-xs text-muted-foreground" role="status">{feedback}</p> : null}
        </div>
      </div>
    </details>
  );
}
