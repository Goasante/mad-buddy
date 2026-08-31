"use client";

import { BookmarkCheck, Clock3, Loader2 } from "lucide-react";
import { useEffect, useMemo, useState, useTransition } from "react";

import {
  getMessageRetentionAction,
  keepMessageInChatAction,
  type MessageRetentionView
} from "@/app/(app)/messaging-retention-v4-actions";
import { cn } from "@/lib/utils";

function remainingLabel(expiresAt: string | null, nowMs: number) {
  if (!expiresAt) return null;
  const remaining = Date.parse(expiresAt) - nowMs;
  if (!Number.isFinite(remaining)) return null;
  if (remaining <= 0) return "Expired";
  const minutes = Math.ceil(remaining / 60_000);
  if (minutes < 60) return `${minutes}m left`;
  const hours = Math.ceil(minutes / 60);
  if (hours < 48) return `${hours}h left`;
  return `${Math.ceil(hours / 24)}d left`;
}

export function MessageRetentionV4({
  conversationId,
  messageId,
  mine
}: {
  conversationId: string;
  messageId: string;
  mine: boolean;
}) {
  const [state, setState] = useState<MessageRetentionView | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    let disposed = false;
    void getMessageRetentionAction({ conversationId, messageId })
      .then((next) => {
        if (!disposed) setState(next);
      })
      .finally(() => {
        if (!disposed) setLoaded(true);
      });
    return () => {
      disposed = true;
    };
  }, [conversationId, messageId]);

  useEffect(() => {
    if (!state?.expiresAt || state.keptAt) return;
    const timer = setInterval(() => setNowMs(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, [state?.expiresAt, state?.keptAt]);

  const label = useMemo(() => remainingLabel(state?.expiresAt ?? null, nowMs), [nowMs, state?.expiresAt]);
  if (!loaded) return <span className="sr-only"><Loader2 className="h-3 w-3" />Loading retention state</span>;
  if (!state || (!state.expiresAt && !state.keptAt && state.mode === "keep")) return null;

  if (state.keptAt) {
    return (
      <div className={cn("mt-1.5 inline-flex min-h-7 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium", mine ? "bg-white/10 text-white/70" : "bg-primary/10 text-primary")}>
        <BookmarkCheck className="h-3 w-3" />
        Kept in chat{state.keptByName ? ` · ${state.keptByName}` : ""}
      </div>
    );
  }

  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
      {label ? <span className={cn("inline-flex min-h-7 items-center gap-1 rounded-full px-2.5 text-xs font-medium", mine ? "bg-white/10 text-white/70" : "bg-black/[0.035] text-muted-foreground dark:bg-white/[0.055]")}><Clock3 className="h-3 w-3" />{label}</span> : null}
      {state.canKeep ? <button type="button" disabled={isPending} onClick={() => startTransition(async () => {
        const result = await keepMessageInChatAction({ conversationId, messageId });
        if (!result.ok) return;
        const next = await getMessageRetentionAction({ conversationId, messageId });
        setState(next);
      })} className={cn("focus-ring inline-flex min-h-7 items-center gap-1 rounded-full px-2.5 text-xs font-semibold transition active:scale-95 disabled:opacity-50", mine ? "bg-white/12 text-primary-foreground" : "bg-primary/10 text-primary")}><BookmarkCheck className="h-3 w-3" />{isPending ? "Keeping…" : "Keep in Chat"}</button> : null}
    </div>
  );
}
