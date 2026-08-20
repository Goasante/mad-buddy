"use client";

import { useMemo, useState, useTransition } from "react";
import { Megaphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { UserAvatar } from "@/components/ui/user-avatar";
import { cn } from "@/lib/utils";
import { postEventUpdateAction, setEventUpdateReactionAction } from "@/app/(app)/event-actions";
import type { EventUpdateView } from "@/lib/events/updates";

/**
 * Event Updates -- reference panel 8.
 *
 * A NOTICEBOARD, NOT A CHAT. One voice publishes, everyone else reads and
 * reacts, so the layout reads top-down like announcements rather than
 * left-right like a conversation. There is deliberately no `isMine`, no
 * justify-end and no message composer for attendees: an attendee cannot post
 * here at all, and a reply box would imply otherwise.
 */

const REACTIONS = [
  { type: "heart", glyph: "❤️", label: "React with heart" },
  { type: "fire", glyph: "🔥", label: "React with fire" },
  { type: "applause", glyph: "👏", label: "React with applause" },
  { type: "wow", glyph: "😮", label: "React with wow" }
] as const;

function relativeTime(iso: string): string {
  const deltaMs = Date.now() - Date.parse(iso);
  const minutes = Math.floor(deltaMs / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(iso).toLocaleDateString([], { month: "short", day: "numeric" });
}

export function EventUpdates({
  eventId,
  updates,
  canPublish,
  onChanged
}: {
  eventId: string;
  updates: EventUpdateView[];
  canPublish: boolean;
  onChanged: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [composerOpen, setComposerOpen] = useState(false);
  const [body, setBody] = useState("");
  const [priority, setPriority] = useState<"normal" | "high">("normal");
  const [feedback, setFeedback] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "important">("all");

  const importantCount = useMemo(
    () => updates.filter((update) => update.priority === "high").length,
    [updates]
  );

  const visible = useMemo(
    () => (filter === "important" ? updates.filter((update) => update.priority === "high") : updates),
    [updates, filter]
  );

  function post() {
    setFeedback(null);
    startTransition(async () => {
      const result = await postEventUpdateAction({ eventId, body, priority });
      setFeedback(result.message);
      if (result.ok) {
        setBody("");
        setPriority("normal");
        setComposerOpen(false);
        onChanged();
      }
    });
  }

  function react(updateId: string, current: string | null, next: string) {
    startTransition(async () => {
      // Tapping the active reaction clears it; tapping another replaces it.
      // One row per person per update, so a count counts people not taps.
      const result = await setEventUpdateReactionAction(updateId, current === next ? null : next);
      if (result.ok) onChanged();
      else setFeedback(result.message);
    });
  }

  return (
    <section aria-labelledby="event-updates-heading" className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h3 id="event-updates-heading" className="text-base font-semibold">
          Updates
        </h3>
        {canPublish ? (
          <Button type="button" size="sm" variant="outline" onClick={() => setComposerOpen((open) => !open)}>
            <Megaphone className="mr-1.5 h-4 w-4" aria-hidden="true" />
            Post update
          </Button>
        ) : null}
      </div>

      {/* All / Important. Offered only once an Important update exists -- a
          filter that cannot change the list is furniture. */}
      {importantCount > 0 ? (
        <div role="radiogroup" aria-label="Filter updates" className="flex gap-2">
          {(
            [
              { id: "all", label: "All" },
              { id: "important", label: "Important" }
            ] as const
          ).map((entry) => {
            const active = filter === entry.id;
            return (
              <button
                key={entry.id}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setFilter(entry.id)}
                className={cn(
                  "min-h-[2rem] rounded-full px-3 text-xs font-medium transition",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                  active ? "bg-primary text-primary-foreground" : "bg-secondary/60 text-muted-foreground"
                )}
              >
                {entry.label}
              </button>
            );
          })}
        </div>
      ) : null}

      {composerOpen && canPublish ? (
        <div className="space-y-2 rounded-xl border border-border/70 bg-background/60 p-3">
          <label htmlFor="event-update-body" className="text-xs font-medium text-muted-foreground">
            What do people need to know?
          </label>
          <Textarea
            id="event-update-body"
            value={body}
            onChange={(changeEvent) => setBody(changeEvent.target.value)}
            placeholder="Parking has moved to Gate B."
            rows={3}
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={priority === "high"}
                onChange={(changeEvent) => setPriority(changeEvent.target.checked ? "high" : "normal")}
              />
              {/* High priority is for information that changes what somebody has
                  to do -- a moved gate, a new time. Not for enthusiasm. */}
              Important — changes what people need to do
            </label>
            <Button type="button" size="sm" disabled={pending || body.trim().length === 0} onClick={post}>
              {pending ? "Posting…" : "Post"}
            </Button>
          </div>
        </div>
      ) : null}

      {feedback ? (
        <p role="status" className="text-xs text-muted-foreground">
          {feedback}
        </p>
      ) : null}

      {visible.length === 0 ? (
        /* Restraint for attendees: an empty noticeboard is not a problem that
           needs a card. The host is the only one who can act on it. */
        canPublish ? (
          <p className="text-sm text-muted-foreground">
            No updates yet. Post one when attendees need to know something.
          </p>
        ) : null
      ) : (
        <ul className="space-y-3">
          {visible.map((update) => (
            <li
              key={update.id}
              /* ACCENT, NOT ALARM.
               *
               * A full orange outline round the whole card made the container
               * louder than the sentence inside it, and every important update
               * read as an emergency. A left rail marks it without shouting; the
               * word "Important" still carries the meaning for anyone who cannot
               * see the colour. */
              className={cn(
                "rounded-xl bg-secondary/30 p-3.5",
                update.priority === "high" ? "border-l-2 border-primary pl-3" : null
              )}
            >
              {update.priority === "high" ? (
                <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-primary">
                  Important
                </p>
              ) : null}

              <div className="mb-2 flex items-center gap-2.5">
                <UserAvatar name={update.authorName} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium leading-tight">{update.authorName}</p>
                  <p className="text-xs text-muted-foreground">
                    {relativeTime(update.createdAt)}
                    {update.editedAt ? " · Edited" : ""}
                  </p>
                </div>
              </div>

              <p className="text-sm leading-6">{update.body}</p>

              <div className="mt-2.5 flex flex-wrap items-center gap-1">
                {REACTIONS.map((reaction) => {
                  const count = update.reactionCounts[reaction.type];
                  const mine = update.myReaction === reaction.type;
                  return (
                    <button
                      key={reaction.type}
                      type="button"
                      aria-label={reaction.label}
                      aria-pressed={mine}
                      disabled={pending}
                      onClick={() => react(update.id, update.myReaction, reaction.type)}
                      /* Compact rail. Reactions are a lightweight response to an
                         update, not a peer of it -- bordered pills stacked a row
                         deep made them the heaviest thing in the card. Touch
                         target stays >=32px via min-h. */
                      className={cn(
                        "inline-flex min-h-[2rem] items-center gap-1 rounded-full px-2 py-1 text-xs transition",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                        mine
                          ? "bg-primary/15 font-semibold text-primary"
                          : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
                      )}
                    >
                      <span aria-hidden="true">{reaction.glyph}</span>
                      {count > 0 ? <span>{count}</span> : null}
                    </button>
                  );
                })}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
