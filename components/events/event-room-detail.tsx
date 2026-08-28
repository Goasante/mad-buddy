"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { Loader2, Pencil, Send, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EventArtwork } from "@/components/events/event-artwork";
import { GlowAvatar } from "@/components/glow/glow-avatar";
import { SafeMessageText } from "@/components/messages/safe-message-text";
import { publicMembershipTier } from "@/lib/billing/premium-identity";
import {
  getMessagesAction,
  markConversationReadAction,
  sendMessageAction
} from "@/app/(app)/messaging-actions";
import {
  listRoomMembersAction,
  listRoomNoticesAction,
  setRoomNoticeReactionAction
} from "@/app/(app)/event-actions";
import type { ChatMessageView } from "@/lib/messaging/mobile";
import type { RoomMemberView, RoomNoticeView, RoomView } from "@/lib/events/rooms";
import { cn } from "@/lib/utils";

/**
 * Room Detail -- reference panel "HOST: ROOM DETAIL".
 *
 * Composition follows the reference exactly: back / name / live status, then a
 * large hero with an overlapping avatar stack and the Room's identity over it,
 * then four tabs, then the tab body. The palette is Mad Buddy's.
 *
 * CHAT IS CANONICAL MESSAGING. Every message here is a row in `messages`, sent
 * through the same sendMessageAction the rest of the app uses, in the Room's
 * one canonical conversation (conversation_type 'event', context_type
 * 'event_circle'). There is no Events-local message store, no second unread
 * model, and no parallel reaction table -- an archived Room becomes read-only
 * because canSendMessage already refuses an archived conversation.
 */

type RoomTab = "chat" | "members" | "notices" | "settings";

const REACTIONS: Array<{ type: "heart" | "fire" | "applause" | "wow"; glyph: string }> = [
  { type: "heart", glyph: "❤️" },
  { type: "fire", glyph: "🔥" },
  { type: "applause", glyph: "👏" },
  { type: "wow", glyph: "😮" }
];

function statusLabel(status: RoomView["status"]): { label: string; live: boolean } {
  switch (status) {
    case "active":
      return { label: "Active", live: true };
    case "open":
      return { label: "Open", live: true };
    case "closing":
      return { label: "Closing", live: false };
    case "archived":
      return { label: "Archived", live: false };
    case "draft":
      return { label: "Draft", live: false };
    default:
      return { label: "Closed", live: false };
  }
}

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export function EventRoomDetail({
  room,
  eventCoverUrl,
  eventFocalX,
  eventFocalY,
  onOpenSettings,
  onOpenQr,
  onLeave
}: {
  room: RoomView;
  eventCoverUrl: string | null;
  eventFocalX: number;
  eventFocalY: number;
  onOpenSettings: () => void;
  onOpenQr: () => void;
  onLeave: () => void;
}) {
  const [tab, setTab] = useState<RoomTab>("chat");
  const [messages, setMessages] = useState<ChatMessageView[]>([]);
  const [members, setMembers] = useState<RoomMemberView[]>([]);
  const [notices, setNotices] = useState<RoomNoticeView[]>([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const status = statusLabel(room.status);
  // Read-only follows the Room's lifecycle, and the server enforces the same
  // rule -- this only decides whether to render a composer that would be
  // refused anyway.
  const readOnly = room.status === "archived" || !room.isMember;

  const loadChat = useCallback(async () => {
    if (!room.conversationId || !room.isMember) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const rows = await getMessagesAction(room.conversationId);
      setMessages(rows);
      // Opening the Room clears its unread count through the canonical read
      // lifecycle, exactly as opening any other conversation does.
      await markConversationReadAction(room.conversationId);
    } catch {
      setError("Couldn't load the chat.");
    } finally {
      setLoading(false);
    }
  }, [room.conversationId, room.isMember]);

  useEffect(() => {
    // Deferred past commit for the same reason as the QR panel: loadChat sets
    // loading state, and doing so in the effect body cascades a render.
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) void loadChat();
    });
    return () => {
      cancelled = true;
    };
  }, [loadChat]);

  /* Members load on MOUNT, not on tab open: the hero shows an overlapping
     avatar stack the way the reference does, so the roster is needed before
     anyone taps Members. Notices stay lazy -- nothing above the fold needs them. */
  useEffect(() => {
    if (!room.isMember) return;
    let cancelled = false;
    void listRoomMembersAction(room.id).then((rows) => {
      if (!cancelled) setMembers(rows);
    });
    return () => {
      cancelled = true;
    };
  }, [room.id, room.isMember]);

  useEffect(() => {
    if (tab !== "notices" || notices.length > 0) return;
    let cancelled = false;
    void listRoomNoticesAction(room.id).then((rows) => {
      if (!cancelled) setNotices(rows);
    });
    return () => {
      cancelled = true;
    };
  }, [tab, room.id, notices.length]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages.length]);

  function send() {
    const text = draft.trim();
    if (!text || !room.conversationId || readOnly) return;
    setDraft("");
    startTransition(async () => {
      const result = await sendMessageAction({
        conversationId: room.conversationId,
        text,
        // Idempotency key: a retried send can never produce a second message.
        clientMessageId: `room-${room.id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      });
      if (!result.ok) {
        setError(result.message);
        setDraft(text);
        return;
      }
      setError("");
      await loadChat();
    });
  }

  function reactToNotice(noticeId: string, reaction: "heart" | "fire" | "applause" | "wow", mine: string | null) {
    startTransition(async () => {
      // Tapping your own reaction again clears it -- one per person, changeable.
      const next = mine === reaction ? null : reaction;
      const result = await setRoomNoticeReactionAction({ noticeId, reaction: next });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setNotices(await listRoomNoticesAction(room.id));
    });
  }

  const tabs: Array<{ id: RoomTab; label: string; shown: boolean }> = [
    { id: "chat", label: "Chat", shown: true },
    { id: "members", label: "Members", shown: true },
    { id: "notices", label: "Notices", shown: true },
    // ORDINARY ATTENDEES DO NOT SEE SETTINGS (§15). Host controls are not
    // merely disabled for them, they are absent.
    { id: "settings", label: "Settings", shown: room.canManage }
  ];

  return (
    <div className="flex h-full flex-col">
      {/* HEADER: back, name, live status, and the host affordances. */}
      <div className="flex items-center gap-2 px-1 pb-2">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-base font-bold">{room.name}</h2>
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span
              className={cn(
                "inline-block h-1.5 w-1.5 rounded-full",
                status.live ? "bg-primary" : "bg-muted-foreground/50"
              )}
              aria-hidden="true"
            />
            {status.label}
          </p>
        </div>
        {room.canManage ? (
          <>
            <Button
              variant="ghost"
              size="sm"
              onClick={onOpenSettings}
              aria-label="Room settings"
              className="h-9 w-9 p-0"
            >
              <Pencil className="h-4 w-4" aria-hidden="true" />
            </Button>
            <Button variant="ghost" size="sm" onClick={onOpenQr} aria-label="Room QR code" className="h-9 w-9 p-0">
              <Share2 className="h-4 w-4" aria-hidden="true" />
            </Button>
          </>
        ) : null}
      </div>

      {/* HERO with the avatar stack, as the reference shows. */}
      <div className="relative -mx-4 sm:-mx-6">
        <EventArtwork
          eventId={room.eventId ?? room.id}
          coverUrl={eventCoverUrl}
          focalX={eventFocalX}
          focalY={eventFocalY}
          alt=""
          scrim="strong"
          className="aspect-[16/9] w-full"
        />
        <div className="absolute inset-x-0 bottom-0 space-y-1 p-4">
          {members.length > 0 ? (
            <div className="flex items-center">
              {members.slice(0, 4).map((member, index) => (
                <div
                  key={member.userId}
                  className={cn("rounded-full ring-2 ring-black/20", index > 0 && "-ml-2.5")}
                >
                  <GlowAvatar
                    name={member.displayName}
                    src={member.avatarUrl}
                    size="sm"
                    membershipTier={publicMembershipTier(member.plan)}
                  />
                </div>
              ))}
              {room.memberCount > 4 ? (
                <span className="-ml-2.5 flex h-8 w-8 items-center justify-center rounded-full bg-black/50 text-[11px] font-semibold text-white ring-2 ring-black/20">
                  +{room.memberCount - 4}
                </span>
              ) : null}
            </div>
          ) : null}
          <h3 className="text-xl font-bold text-white drop-shadow-sm">{room.name}</h3>
          {room.description ? <p className="text-sm text-white/85">{room.description}</p> : null}
          <p className="text-sm text-white/70">
            {room.memberCount} {room.memberCount === 1 ? "member" : "members"}
          </p>
        </div>
      </div>

      {/* TABS directly beneath the hero, per the reference. */}
      <div role="tablist" aria-label="Room sections" className="flex border-b border-border/60">
        {tabs
          .filter((entry) => entry.shown)
          .map((entry) => (
            <button
              key={entry.id}
              role="tab"
              aria-selected={tab === entry.id}
              onClick={() => setTab(entry.id)}
              className={cn(
                "min-h-[2.75rem] flex-1 border-b-2 px-2 text-sm font-medium transition",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                tab === entry.id
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              {entry.label}
            </button>
          ))}
      </div>

      {error ? (
        <p role="alert" className="px-1 pt-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {/* ---------------------------------------------------------------- CHAT */}
      {tab === "chat" ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto py-3">
            {!room.isMember ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                Join this room to see the chat.
              </p>
            ) : loading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-hidden="true" />
              </div>
            ) : messages.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                No messages yet. Say hello.
              </p>
            ) : (
              messages.map((message) => (
                <div key={message.id} className="flex items-start gap-2.5">
                  <GlowAvatar
                    name={message.senderName}
                    src={message.senderAvatarUrl}
                    size="sm"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="flex items-baseline gap-2">
                      <span className="text-sm font-semibold">{message.senderName}</span>
                      <span className="text-[11px] text-muted-foreground">
                        {timeLabel(message.createdAt)}
                      </span>
                    </p>
                    {/* Same safe renderer the Messages surface uses: message
                        text is never injected as markup anywhere. */}
                    <SafeMessageText text={message.text ?? ""} />
                  </div>
                </div>
              ))
            )}
          </div>

          {/* COMPOSER. Absent when the Room is read-only rather than present
              and broken -- an archived Room says so instead of accepting text
              the server would refuse. */}
          {room.isMember ? (
            readOnly ? (
              <p className="border-t border-border/60 py-3 text-center text-xs text-muted-foreground">
                This room is archived. History stays readable.
              </p>
            ) : (
              <form
                method="post"
                className="flex items-center gap-2 border-t border-border/60 pt-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  send();
                }}
              >
                <input
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  placeholder={`Message ${room.name}...`}
                  aria-label={`Message ${room.name}`}
                  maxLength={2000}
                  className="min-h-[2.75rem] flex-1 rounded-full border border-border bg-background px-4 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                />
                <Button
                  type="submit"
                  size="sm"
                  disabled={pending || draft.trim().length === 0}
                  aria-label="Send message"
                  className="h-11 w-11 shrink-0 rounded-full p-0"
                >
                  {pending ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <Send className="h-4 w-4" aria-hidden="true" />
                  )}
                </Button>
              </form>
            )
          ) : null}
        </div>
      ) : null}

      {/* ------------------------------------------------------------- MEMBERS */}
      {tab === "members" ? (
        <div className="flex-1 space-y-1 overflow-y-auto py-3">
          {members.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No members to show.</p>
          ) : (
            members.map((member) => (
              <div key={member.userId} className="flex items-center gap-3 rounded-xl px-1 py-2">
                <GlowAvatar
                  name={member.displayName}
                  src={member.avatarUrl}
                  size="sm"
                  membershipTier={publicMembershipTier(member.plan)}
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {member.displayName}
                    {member.isMe ? <span className="text-muted-foreground"> (you)</span> : null}
                  </p>
                  {/* Role only where it means something. "Member" on every row
                      is noise. */}
                  {member.role !== "member" ? (
                    <p className="text-xs capitalize text-muted-foreground">
                      {member.role.replace("_", "-")}
                    </p>
                  ) : null}
                </div>
              </div>
            ))
          )}
        </div>
      ) : null}

      {/* ------------------------------------------------------------- NOTICES */}
      {tab === "notices" ? (
        <div className="flex-1 space-y-3 overflow-y-auto py-3">
          {notices.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No notices yet. The host posts them here.
            </p>
          ) : (
            notices.map((notice) => (
              <article
                key={notice.id}
                className={cn(
                  "space-y-2 rounded-xl p-3.5",
                  notice.priority === "high"
                    ? "border-l-2 border-primary bg-primary/5"
                    : "bg-secondary/40"
                )}
              >
                <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-primary">
                  Notice
                </p>
                <p className="text-sm font-semibold">{notice.title}</p>
                <p className="text-sm leading-relaxed text-foreground">{notice.body}</p>
                <p className="text-[11px] text-muted-foreground">
                  {notice.authorName} · {timeLabel(notice.publishedAt)}
                </p>

                {/* REAL REACTIONS. Persisted one-per-person, changeable, and
                    counted server-side -- the reference shows them, so they
                    are not decoration. */}
                <div className="flex flex-wrap items-center gap-1.5">
                  {REACTIONS.map((reaction) => {
                    const count =
                      notice.reactions.find((entry) => entry.type === reaction.type)?.count ?? 0;
                    const mine = notice.myReaction === reaction.type;
                    if (count === 0 && !mine && notice.myReaction !== null) return null;
                    return (
                      <button
                        key={reaction.type}
                        type="button"
                        disabled={pending || !room.isMember}
                        onClick={() => reactToNotice(notice.id, reaction.type, notice.myReaction)}
                        aria-label={`React ${reaction.type}`}
                        aria-pressed={mine}
                        className={cn(
                          "inline-flex min-h-[2rem] items-center gap-1 rounded-full px-2.5 text-xs transition",
                          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                          mine
                            ? "bg-primary/15 text-foreground ring-1 ring-primary/40"
                            : "bg-background/70 text-muted-foreground hover:bg-background"
                        )}
                      >
                        <span aria-hidden="true">{reaction.glyph}</span>
                        {count > 0 ? count : null}
                      </button>
                    );
                  })}
                </div>
              </article>
            ))
          )}
        </div>
      ) : null}

      {/* ------------------------------------------------------------ SETTINGS */}
      {tab === "settings" && room.canManage ? (
        <div className="flex-1 space-y-3 overflow-y-auto py-3">
          <Button variant="secondary" onClick={onOpenSettings} className="min-h-[2.75rem] w-full">
            Room settings
          </Button>
          <Button variant="secondary" onClick={onOpenQr} className="min-h-[2.75rem] w-full">
            Show room QR
          </Button>
        </div>
      ) : null}

      {/* Leaving is always available to a member who is not the host: the host
          archives instead, since leaving would orphan the Room. */}
      {room.isMember && room.myRole !== "host" && tab !== "chat" ? (
        <Button variant="ghost" onClick={onLeave} className="mt-2 min-h-[2.75rem] w-full text-destructive">
          Leave room
        </Button>
      ) : null}
    </div>
  );
}
