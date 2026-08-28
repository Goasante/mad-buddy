"use client";

import { CheckCheck, Clock3, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";

import { getMessageInfoAction } from "@/app/(app)/messaging-v4-insights-actions";
import { Modal } from "@/components/ui/modal";
import { UserAvatar } from "@/components/ui/user-avatar";
import type { MessageInfoView } from "@/lib/messaging/v4-insights-types";

function formatWhen(value: string | null) {
  if (!value) return "Read";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Read";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
}

export function MessageInfoV4({
  messageId,
  open,
  onOpenChange
}: {
  messageId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [info, setInfo] = useState<MessageInfoView | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    let disposed = false;
    setLoading(true);
    void getMessageInfoAction(messageId)
      .then((next) => {
        if (!disposed) setInfo(next);
      })
      .finally(() => {
        if (!disposed) setLoading(false);
      });
    return () => {
      disposed = true;
    };
  }, [messageId, open]);

  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Message info" variant="sheet">
      {loading ? (
        <div className="grid min-h-36 place-items-center" role="status" aria-label="Loading message information">
          <Loader2 className="h-5 w-5 animate-spin text-[#E88C2B] motion-reduce:animate-none" />
        </div>
      ) : !info ? (
        <p className="py-8 text-center text-sm text-muted-foreground">Message information is not available.</p>
      ) : (
        <div className="space-y-4 pb-[max(.5rem,env(safe-area-inset-bottom))]">
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-2xl border border-border/60 bg-card/60 p-3">
              <Clock3 className="h-4 w-4 text-[#E88C2B]" />
              <strong className="mt-2 block text-xs">Sent</strong>
              <span className="mt-0.5 block text-[11px] text-muted-foreground">{formatWhen(info.createdAt)}</span>
            </div>
            <div className="rounded-2xl border border-border/60 bg-card/60 p-3">
              <CheckCheck className="h-4 w-4 text-[#E88C2B]" />
              <strong className="mt-2 block text-xs capitalize">{info.state.replaceAll("_", " ")}</strong>
              <span className="mt-0.5 block text-[11px] text-muted-foreground">Current delivery state</span>
            </div>
          </div>

          <section className="overflow-hidden rounded-[22px] border border-border/60 bg-card/60">
            <div className="border-b border-border/50 px-4 py-3">
              <strong className="block text-sm">Read by</strong>
              <span className="text-[11px] text-muted-foreground">
                {info.readBy.length > 0
                  ? `${info.readBy.length} ${info.readBy.length === 1 ? "person" : "people"}`
                  : "No read receipts yet"}
              </span>
            </div>
            {info.readBy.length === 0 ? (
              <div className="px-4 py-7 text-center text-xs text-muted-foreground">Nobody with read receipts enabled has reached this message yet.</div>
            ) : (
              <ul className="divide-y divide-border/45">
                {info.readBy.map((person) => (
                  <li key={person.userId} className="flex min-h-[62px] items-center gap-3 px-3 py-2.5">
                    <UserAvatar src={person.avatarUrl} name={person.displayName} size="sm" />
                    <div className="min-w-0 flex-1">
                      <strong className="block truncate text-sm">{person.displayName}</strong>
                      <span className="block truncate text-[11px] text-muted-foreground">
                        {person.username ? `@${person.username} · ` : ""}{formatWhen(person.readAt)}
                      </span>
                    </div>
                    <CheckCheck className="h-4 w-4 shrink-0 text-[#E88C2B]" aria-label="Read" />
                  </li>
                ))}
              </ul>
            )}
            {info.unreadReceiptCount > 0 ? (
              <div className="border-t border-border/45 px-4 py-3 text-[11px] text-muted-foreground">
                {info.unreadReceiptCount} more {info.unreadReceiptCount === 1 ? "member has" : "members have"} not sent a read receipt yet.
              </div>
            ) : null}
          </section>

          {info.editedAt ? (
            <p className="px-1 text-[11px] text-muted-foreground">Edited {formatWhen(info.editedAt)}</p>
          ) : null}
        </div>
      )}
    </Modal>
  );
}
