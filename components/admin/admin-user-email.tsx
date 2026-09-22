"use client";

import { useState, useTransition } from "react";
import { LoaderCircle, Mail } from "lucide-react";
import { sendAdminUserEmailAction } from "@/app/(admin)/admin/users/email-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export function AdminUserEmail({
  userId,
  senderLabel
}: {
  userId: string;
  senderLabel: string;
}) {
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [feedback, setFeedback] = useState("");
  const [pending, startTransition] = useTransition();

  function send() {
    const requestId = crypto.randomUUID();
    setFeedback("");

    startTransition(async () => {
      const result = await sendAdminUserEmailAction({
        userId,
        subject: subject.trim(),
        message: message.trim(),
        requestId
      });

      setFeedback(result.message);
      if (result.ok) {
        setSubject("");
        setMessage("");
      }
    });
  }

  const canSend = subject.trim().length >= 2 && message.trim().length >= 2;

  return (
    <details className="group md:col-span-5">
      <summary className="focus-ring safe-motion flex w-fit cursor-pointer list-none items-center gap-2 rounded-lg px-2 py-1.5 text-xs font-medium text-muted-foreground hover:bg-secondary hover:text-foreground">
        <Mail className="h-3.5 w-3.5" aria-hidden="true" />
        Email user
      </summary>

      <div className="mt-3 space-y-3 rounded-xl border border-border/70 bg-secondary/20 p-3">
        <p className="text-[11px] text-muted-foreground">
          Sends from <span className="font-semibold text-foreground">{senderLabel}</span> to the user&rsquo;s registered account email.
        </p>

        <Input
          value={subject}
          onChange={(event) => setSubject(event.target.value)}
          placeholder="Subject"
          maxLength={120}
          disabled={pending}
          aria-label="Email subject"
        />

        <Textarea
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          placeholder="Write the email message…"
          maxLength={5000}
          rows={5}
          disabled={pending}
          aria-label="Email message"
        />

        <div className="flex items-center justify-between gap-3">
          {feedback ? (
            <p className="min-w-0 truncate text-xs text-muted-foreground" role="status">
              {feedback}
            </p>
          ) : (
            <span />
          )}

          <Button type="button" size="sm" disabled={pending || !canSend} onClick={send}>
            {pending ? (
              <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Mail className="h-4 w-4" aria-hidden="true" />
            )}
            Send email
          </Button>
        </div>
      </div>
    </details>
  );
}
