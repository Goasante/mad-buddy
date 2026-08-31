"use client";

import { Check, LockKeyhole } from "lucide-react";
import { useMemo, useState, useTransition } from "react";

import { voteChatPollAction } from "@/app/(app)/messaging-ultimate-actions";
import type { ChatPollView } from "@/lib/messaging/ultimate-types";
import { cn } from "@/lib/utils";

export function ChatPollCard({
  poll,
  mine,
  onChanged
}: {
  poll: ChatPollView;
  mine: boolean;
  onChanged?: () => void | Promise<void>;
}) {
  const [optimisticVotes, setOptimisticVotes] = useState<string[] | null>(null);
  const [isPending, startTransition] = useTransition();
  const selected = useMemo(
    () => optimisticVotes ?? poll.options.filter((option) => option.votedByMe).map((option) => option.id),
    [optimisticVotes, poll.options]
  );
  const totalVotes = Math.max(1, poll.options.reduce((sum, option) => sum + option.voteCount, 0));

  function choose(optionId: string) {
    if (poll.closedAt || isPending) return;
    const next = poll.allowMultiple
      ? selected.includes(optionId)
        ? selected.filter((id) => id !== optionId)
        : [...selected, optionId]
      : selected.includes(optionId)
        ? []
        : [optionId];
    setOptimisticVotes(next);
    startTransition(async () => {
      const result = await voteChatPollAction({ pollMessageId: poll.messageId, optionIds: next });
      if (!result.ok) setOptimisticVotes(null);
      else await onChanged?.();
    });
  }

  return (
    <section className={cn("min-w-[250px] max-w-[340px] rounded-[18px] p-1", mine ? "text-primary-foreground" : "text-foreground")} aria-label={`Poll: ${poll.question}`}>
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold leading-snug">{poll.question}</p>
          <p className={cn("mt-1 text-xs font-normal", mine ? "text-white/55" : "text-muted-foreground")}>
            {poll.allowMultiple ? "Select one or more" : "Select one"} · {poll.totalVoters} {poll.totalVoters === 1 ? "vote" : "voters"}
          </p>
        </div>
        {poll.closedAt ? <LockKeyhole className="h-4 w-4 shrink-0 opacity-55" aria-label="Poll closed" /> : null}
      </div>

      <div className="space-y-2">
        {poll.options.map((option) => {
          const active = selected.includes(option.id);
          const adjustedVotes = option.voteCount + (active && !option.votedByMe ? 1 : 0) - (!active && option.votedByMe ? 1 : 0);
          const percent = Math.round((Math.max(0, adjustedVotes) / totalVotes) * 100);
          return (
            <button
              key={option.id}
              type="button"
              onClick={() => choose(option.id)}
              disabled={Boolean(poll.closedAt) || isPending}
              className={cn(
                "focus-ring group relative block min-h-11 w-full overflow-hidden rounded-xl border px-3 py-2 text-left transition-transform active:scale-[.985]",
                mine ? "border-white/14 bg-white/7" : "border-black/[0.06] bg-black/[0.025] dark:border-white/[0.08] dark:bg-white/[0.04]"
              )}
            >
              <span
                aria-hidden="true"
                className={cn("absolute inset-y-0 left-0 transition-[width] duration-500 ease-[cubic-bezier(.2,.8,.2,1)]", mine ? "bg-primary/25" : "bg-primary/15")}
                style={{ width: `${percent}%` }}
              />
              <span className="relative flex items-center gap-2">
                <span className={cn("grid h-5 w-5 shrink-0 place-items-center rounded-full border transition", active ? "border-primary bg-primary text-primary-foreground scale-105" : mine ? "border-white/30" : "border-black/15 dark:border-white/20")}>
                  {active ? <Check className="h-3 w-3" /> : null}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{option.label}</span>
                <span className={cn("text-xs font-medium", mine ? "text-white/60" : "text-muted-foreground")}>{Math.max(0, adjustedVotes)}</span>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
