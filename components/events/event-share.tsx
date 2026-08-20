"use client";

import { useEffect, useState } from "react";
import { Check, Copy, Link2, MessageCircle, Share2, Users2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { UserAvatar } from "@/components/ui/user-avatar";
import { shareEventToConversationAction } from "@/app/(app)/event-actions";
import { getConversationsAction } from "@/app/(app)/messaging-actions";
import type { ConversationView } from "@/lib/messaging/mobile";
import { shareInvite } from "@/lib/device/invite-share";
import { cn } from "@/lib/utils";

/**
 * Sharing an Event.
 *
 * TRANSPORT, NOT PERMISSION. Sending somebody a link does not grant them
 * anything: whoever opens it still meets canViewEvent, so an invite-only Event
 * forwarded into a Circle stays invite-only and refuses everybody who was not
 * invited. That separation is the whole reason this can be offered on every
 * Event rather than only on public ones.
 *
 * THE URL IS THE EXISTING ROUTE. Event ids are gen_random_uuid() -- 122 bits,
 * not enumerable -- and canViewEvent already grants `link` Events direct access
 * while keeping them out of every discovery surface. A second "share token"
 * identity would add a table, a lookup and a revocation story for no security
 * gain, so this reuses /events?event=<id>.
 *
 * IN-APP SHARING REUSES CANONICAL MESSAGING. The action hands the composed
 * message to sendMessage, which already owns membership, blocks, rate limiting
 * and moderation. Events does not get a second chat engine.
 */

/** The shareable URL for an Event. One definition, used by every caller. */
export function eventShareUrl(eventId: string): string {
  /* window.location.origin is the honest origin when a host is testing on a
   * device; a link built from the wrong one is worse than no link. */
  const origin =
    typeof window !== "undefined" ? window.location.origin : process.env.NEXT_PUBLIC_APP_URL ?? "";
  return `${origin}/events?event=${eventId}`;
}

type Outcome = "idle" | "copied" | "shared" | "sent" | "unavailable" | "failed";

export function EventShare({
  eventId,
  eventName,
  visibility,
  className,
  /** Drafts have no shareable identity; the caller says so rather than guessing. */
  shareable = true
}: {
  eventId: string;
  eventName: string;
  visibility: string;
  className?: string;
  shareable?: boolean;
}) {
  const [outcome, setOutcome] = useState<Outcome>("idle");
  const [detail, setDetail] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);

  const shareUrl = eventShareUrl(eventId);
  const unlisted = visibility === "link";

  async function share() {
    const result = await shareInvite(shareUrl, `${eventName} — on Mad Buddy`);
    setOutcome(result === "unavailable" ? "unavailable" : result === "copied" ? "copied" : "shared");
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setOutcome("copied");
    } catch {
      // No clipboard permission. Say so rather than leaving a button that
      // looks like it worked.
      setOutcome("unavailable");
    }
  }

  if (!shareable) {
    return (
      <section className={cn("space-y-1.5 rounded-xl bg-secondary/40 p-3.5", className)}>
        <p className="text-sm font-medium">Not shareable yet</p>
        <p className="text-xs text-muted-foreground">
          Publish this event and its link becomes active.
        </p>
      </section>
    );
  }

  return (
    <section
      className={cn("space-y-2.5 rounded-xl bg-secondary/40 p-3.5", className)}
      aria-labelledby="event-share"
    >
      <div className="flex items-center gap-2">
        <Link2 className="h-4 w-4 text-primary" aria-hidden="true" />
        <h3 id="event-share" className="text-sm font-semibold">
          Share this event
        </h3>
      </div>

      <p className="text-xs leading-relaxed text-muted-foreground">
        {unlisted
          ? "This event is unlisted, so the link is the only way in. Anyone you send it to can open it."
          : "Send the link to anyone you want there. They still need access to open it."}
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={() => setPickerOpen(true)}>
          <MessageCircle className="mr-1.5 h-4 w-4" aria-hidden="true" />
          Send in Mad Buddy
        </Button>
        <Button size="sm" variant="outline" onClick={copy}>
          <Copy className="mr-1.5 h-4 w-4" aria-hidden="true" />
          Copy link
        </Button>
        <Button size="sm" variant="ghost" onClick={share} className="text-muted-foreground">
          <Share2 className="mr-1.5 h-4 w-4" aria-hidden="true" />
          More
        </Button>
      </div>

      {/* role="status" so the confirmation is announced, not merely seen -- a
          silent visual tick tells a screen-reader user nothing. */}
      <p role="status" className="min-h-[1.25rem] text-xs">
        {outcome === "copied" ? (
          <span className="inline-flex items-center gap-1 font-medium text-primary">
            <Check className="h-3.5 w-3.5" aria-hidden="true" />
            Link copied
          </span>
        ) : outcome === "sent" ? (
          <span className="inline-flex items-center gap-1 font-medium text-primary">
            <Check className="h-3.5 w-3.5" aria-hidden="true" />
            {detail || "Sent"}
          </span>
        ) : outcome === "shared" ? (
          <span className="text-muted-foreground">Shared</span>
        ) : outcome === "failed" ? (
          <span className="text-destructive">{detail}</span>
        ) : outcome === "unavailable" ? (
          <span className="text-muted-foreground">
            Copying is not available here. The link is {shareUrl}
          </span>
        ) : null}
      </p>

      <ShareToChatSheet
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        eventId={eventId}
        onSent={(where) => {
          setDetail(`Sent to ${where}`);
          setOutcome("sent");
        }}
        onFailed={(message) => {
          setDetail(message);
          setOutcome("failed");
        }}
      />
    </section>
  );
}

/**
 * Choosing where to send it.
 *
 * Lists the conversations this person already has -- chats and Circles alike,
 * since a Circle IS a group conversation here. Posting an Event into a Circle
 * changes nothing about who may open it.
 */
function ShareToChatSheet({
  open,
  onOpenChange,
  eventId,
  onSent,
  onFailed
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  eventId: string;
  onSent: (where: string) => void;
  onFailed: (message: string) => void;
}) {
  const [conversations, setConversations] = useState<ConversationView[] | null>(null);
  const [sendingTo, setSendingTo] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      const rows = await getConversationsAction();
      if (!cancelled) setConversations(rows);
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  async function send(conversation: ConversationView) {
    setSendingTo(conversation.id);
    const result = await shareEventToConversationAction(eventId, conversation.id);
    setSendingTo(null);
    if (result.ok) {
      onSent(conversation.title);
      onOpenChange(false);
    } else {
      onFailed(result.message);
      onOpenChange(false);
    }
  }

  const groups = (conversations ?? []).filter((row) => row.kind === "group");
  const direct = (conversations ?? []).filter((row) => row.kind !== "group");

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      variant="sheet"
      title="Send in Mad Buddy"
      description="Sharing sends the link. Who can open it does not change."
    >
      <div className="max-h-[60vh] space-y-4 overflow-y-auto">
        {conversations === null ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Loading your chats…</p>
        ) : conversations.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            You have no chats yet. Copy the link instead.
          </p>
        ) : null}

        {[
          { label: "Chats", rows: direct, icon: MessageCircle },
          { label: "Circles", rows: groups, icon: Users2 }
        ]
          .filter((section) => section.rows.length > 0)
          .map((section) => {
            const Icon = section.icon;
            return (
              <section key={section.label} className="space-y-1">
                <h3 className="px-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  {section.label}
                </h3>
                <ul className="divide-y divide-border/40">
                  {section.rows.map((row) => (
                    <li key={row.id}>
                      <button
                        type="button"
                        onClick={() => send(row)}
                        disabled={sendingTo !== null}
                        className="flex min-h-[3.25rem] w-full items-center gap-3 px-1 py-2 text-left transition hover:bg-secondary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-60"
                      >
                        {row.avatarUrl || row.kind !== "group" ? (
                          <UserAvatar name={row.title} src={row.avatarUrl} size="sm" />
                        ) : (
                          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-secondary">
                            <Icon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                          </span>
                        )}
                        <span className="min-w-0 flex-1 truncate font-medium">{row.title}</span>
                        {sendingTo === row.id ? (
                          <span className="shrink-0 text-xs text-muted-foreground">Sending…</span>
                        ) : null}
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
      </div>
    </Modal>
  );
}
