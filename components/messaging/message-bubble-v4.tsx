"use client";

import { Bookmark, Check, CheckCheck, Copy, Forward, Info, Pin, Reply, Trash2, Pencil, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { ChatPollCard } from "@/components/messaging/chat-poll-card";
import { MessageAttachmentImage } from "@/components/messaging/message-attachment-image";
import { MessageInfoV4 } from "@/components/messaging/message-info-v4";
import {
  invalidateConversationReactionSummaries,
  useConversationReactionSummaries
} from "@/components/messaging/reaction-summary-cache-v4";
import { RichMediaMessageV4 } from "@/components/messaging/rich-media-message-v4";
import { StructuredMessageCardV4 } from "@/components/messaging/structured-message-card-v4";
import { VoiceMessageBubbleV4 } from "@/components/messaging/voice-message-bubble-v4";
import { SafeMessageText } from "@/components/messages/safe-message-text";
import { UserAvatar } from "@/components/ui/user-avatar";
import { Modal } from "@/components/ui/modal";
import { PremiumPlanBadge } from "@/components/premium/premium-plan-badge";
import { TrustedMemberMark } from "@/components/trust/trusted-member-mark";
import { VerifiedAccountMark } from "@/components/trust/verified-account-mark";
import type { AttachmentView } from "@/lib/messaging/attachments";
import type { ChatMessageView } from "@/lib/messaging/mobile";
import type { ReactionAggregate } from "@/lib/messaging/reaction-summary-types";
import type { ChatPollView } from "@/lib/messaging/ultimate-types";
import { DELETED_MESSAGE_PLACEHOLDER } from "@/lib/messaging/rules";
import { cn } from "@/lib/utils";

const REPLY_THRESHOLD = 58;
const MAX_REPLY_DRAG = 82;
const LONG_PRESS_MS = 430;
const MOVE_CANCEL = 12;

const REACTIONS = [
  ["heart", "❤️"],
  ["laugh", "😂"],
  ["thumbs_up", "👍"],
  ["wave", "👋"],
  ["fire", "🔥"],
  ["wow", "😮"]
] as const;

function reactionEmoji(id: string) {
  return REACTIONS.find(([reaction]) => reaction === id)?.[1] ?? "•";
}

function haptic(pattern: number | number[]) {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    // Optional in PWA/browser environments.
  }
}

function deliveryIcon(state: string) {
  if (state === "seen") return <CheckCheck className="h-3.5 w-3.5 text-primary" aria-label="Seen" />;
  if (state === "delivered") return <CheckCheck className="h-3.5 w-3.5" aria-label="Delivered" />;
  if (state === "sent") return <Check className="h-3.5 w-3.5" aria-label="Sent" />;
  return null;
}

export function MessageBubbleV4({
  conversationId,
  message,
  showIdentity,
  isGroup,
  replyContext,
  poll,
  saved,
  pinned,
  highlighted,
  voiceInitialSeconds = 0,
  reactionAggregates = [],
  onReply,
  onReact,
  onShowReactors,
  onCopy,
  onEdit,
  onDelete,
  onSave,
  onPin,
  onForward,
  onOpenMedia,
  onAttachmentRefresh,
  onPollChanged
}: {
  conversationId: string;
  message: ChatMessageView;
  showIdentity: boolean;
  isGroup: boolean;
  replyContext?: { senderName: string; text: string } | null;
  poll?: ChatPollView | null;
  saved: boolean;
  pinned: boolean;
  highlighted?: boolean;
  voiceInitialSeconds?: number;
  reactionAggregates?: ReactionAggregate[];
  onReply: () => void;
  onReact: (reaction: string) => void;
  onShowReactors?: (aggregate: ReactionAggregate) => void;
  onCopy: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onSave: () => void;
  onPin: () => void;
  onForward: () => void;
  onOpenMedia: () => void;
  onAttachmentRefresh: (attachment: AttachmentView) => void;
  onPollChanged?: () => void | Promise<void>;
}) {
  const [dragX, setDragX] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [thresholdHit, setThresholdHit] = useState(false);
  const [reactorAggregate, setReactorAggregate] = useState<ReactionAggregate | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);
  const startRef = useRef<{ x: number; y: number; pointerId: number } | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressedRef = useRef(false);
  const reactionMap = useConversationReactionSummaries(conversationId);
  const liveAggregates = reactionAggregates.length > 0 ? reactionAggregates : reactionMap[message.id] ?? [];

  function clearTimer() {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
  }

  useEffect(() => () => clearTimer(), []);

  useEffect(() => {
    invalidateConversationReactionSummaries(conversationId);
  }, [conversationId, message.myReaction]);

  function begin(event: React.PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    startRef.current = { x: event.clientX, y: event.clientY, pointerId: event.pointerId };
    longPressedRef.current = false;
    setDragging(false);
    setThresholdHit(false);
    clearTimer();
    timerRef.current = setTimeout(() => {
      longPressedRef.current = true;
      setActionsOpen(true);
      haptic(8);
    }, LONG_PRESS_MS);
  }

  function move(event: React.PointerEvent<HTMLDivElement>) {
    const start = startRef.current;
    if (!start || start.pointerId !== event.pointerId || actionsOpen) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (Math.abs(dx) < 5 && Math.abs(dy) < 5) return;
    if (Math.abs(dy) > Math.abs(dx) || dx < 0) {
      if (Math.abs(dx) > MOVE_CANCEL || Math.abs(dy) > MOVE_CANCEL) clearTimer();
      return;
    }
    clearTimer();
    setDragging(true);
    const next = Math.min(MAX_REPLY_DRAG, dx * 0.78);
    setDragX(next);
    const hit = next >= REPLY_THRESHOLD;
    if (hit !== thresholdHit) {
      setThresholdHit(hit);
      if (hit) haptic(7);
    }
    if (event.cancelable) event.preventDefault();
  }

  function finish(event: React.PointerEvent<HTMLDivElement>, cancelled = false) {
    const start = startRef.current;
    if (!start || start.pointerId !== event.pointerId) return;
    startRef.current = null;
    clearTimer();
    const shouldReply = !cancelled && dragX >= REPLY_THRESHOLD;
    setDragging(false);
    setDragX(0);
    setThresholdHit(false);
    if (longPressedRef.current) {
      longPressedRef.current = false;
      return;
    }
    if (shouldReply) onReply();
  }

  function react(reaction: string) {
    onReact(reaction);
    haptic(5);
    window.setTimeout(() => invalidateConversationReactionSummaries(conversationId), 250);
  }

  function showReactors(aggregate: ReactionAggregate) {
    if (onShowReactors) onShowReactors(aggregate);
    else setReactorAggregate(aggregate);
  }

  const myReaction = REACTIONS.find(([id]) => id === message.myReaction)?.[1] ?? null;
  const bubble = (
    <div className={cn("relative", message.isMine && "flex flex-col items-end", actionsOpen && "z-50") }>
      {showIdentity && !message.isMine && isGroup ? (
        <div className="mb-1 flex max-w-full items-center gap-1.5 px-1 text-xs font-medium text-muted-foreground">
          <UserAvatar src={message.senderAvatarUrl} name={message.senderName} size="xs" decorative />
          <span className="truncate">{message.senderName}</span>
          <PremiumPlanBadge plan={message.senderPlan} compact />
          <TrustedMemberMark trustedSince={message.senderTrustedSince} compact />
          <VerifiedAccountMark isVerifiedAccount={message.senderIsVerifiedAccount} compact />
          {message.senderRole === "owner" || message.senderRole === "admin" ? <span className="font-normal opacity-70">· {message.senderRole === "owner" ? "Owner" : "Admin"}</span> : null}
        </div>
      ) : null}

      {/* The reply icon deliberately renders 42px outside this box, and the
          drag pushes the bubble further right. Neither may widen the thread's
          scroll area -- that is clamped by `overflow-x-hidden` on the scroll
          container itself, which stops the sideways panning without cropping
          the icon the gesture needs to reveal. Clipping here would hide it. */}
      <div className="relative">
        <div aria-hidden="true" className={cn("absolute inset-y-0 left-0 grid w-12 place-items-center text-primary transition-opacity", dragX > 14 ? "opacity-100" : "opacity-0")} style={{ transform: "translateX(-42px)" }}>
          <Reply className={cn("h-5 w-5 transition-transform", thresholdHit && "scale-125")} />
        </div>
        <div
          onPointerDown={begin}
          onPointerMove={move}
          onPointerUp={(event) => finish(event)}
          onPointerCancel={(event) => finish(event, true)}
          onContextMenu={(event) => {
            event.preventDefault();
            clearTimer();
            setActionsOpen(true);
          }}
          onDoubleClick={() => react("heart")}
          className={cn(
            "touch-pan-y select-none",
            !dragging && "transition-transform duration-300 ease-[cubic-bezier(.2,.8,.2,1)]",
            actionsOpen && "scale-[1.018]"
          )}
          style={{ transform: `translate3d(${dragX}px,0,0)` }}
        >
          <div className={cn(
            "relative overflow-hidden rounded-[21px] px-3.5 py-2.5 text-sm leading-6 shadow-[0_1px_2px_rgba(78,4,1,0.07)] transition-[box-shadow,transform,background-color] duration-300",
            message.isMine ? "rounded-br-[7px] bg-primary text-primary-foreground" : "rounded-bl-[7px] border border-border/60 bg-card text-foreground",
            highlighted && "ring-2 ring-[#E88C2B]/70 shadow-[0_0_0_5px_rgba(232,140,43,.08)]",
            actionsOpen && "shadow-[0_16px_44px_rgba(78,4,1,.2)]"
          )}>
            {replyContext ? (
              <button type="button" onClick={onReply} className={cn("mb-2 block w-full rounded-xl border-l-2 border-[#E88C2B] px-2.5 py-1.5 text-left text-xs", message.isMine ? "bg-white/10" : "bg-primary/10")}>
                <strong className={message.isMine ? "text-primary-foreground/80" : "text-primary"}>{replyContext.senderName}</strong>
                <span className="mt-0.5 block line-clamp-2 opacity-75">{replyContext.text}</span>
              </button>
            ) : null}

            {!message.deleted && message.attachment ? (
              <MessageAttachmentImage conversationId={conversationId} message={message} onOpen={onOpenMedia} onRefreshed={onAttachmentRefresh} />
            ) : null}
            {!message.deleted && message.voice ? (
              <VoiceMessageBubbleV4 conversationId={conversationId} messageId={message.id} senderName={message.isMine ? "you" : message.senderName} asset={message.voice} initialSeconds={voiceInitialSeconds} />
            ) : null}
            {!message.deleted && (message.messageType === "video" || message.messageType === "file") ? (
              <RichMediaMessageV4 conversationId={conversationId} messageId={message.id} kind={message.messageType} mine={message.isMine} />
            ) : null}
            {!message.deleted && (message.messageType === "contact" || message.messageType === "place" || message.messageType === "event") ? (
              <StructuredMessageCardV4 conversationId={conversationId} messageId={message.id} messageType={message.messageType} mine={message.isMine} />
            ) : null}
            {!message.deleted && message.messageType === "poll" && poll ? (
              <ChatPollCard poll={poll} mine={message.isMine} onChanged={onPollChanged} />
            ) : null}
            {/* A tombstone carries no text -- the projection nulls it -- so the deleted
                state must be checked BEFORE message.text, or the placeholder never renders. */}
            {message.deleted ? (
              <SafeMessageText text={DELETED_MESSAGE_PLACEHOLDER} />
            ) : message.text ? (
              <SafeMessageText text={message.text} mentions={message.mentions} />
            ) : null}
            {message.editedAt && !message.deleted ? <span className={cn("ml-1 text-xs", message.isMine ? "text-white/55" : "text-muted-foreground")}>edited</span> : null}
            <div className={cn("mt-1 flex items-center justify-end gap-1 text-xs font-normal", message.isMine ? "text-white/55" : "text-muted-foreground/75")}>
              {saved ? <Bookmark className="h-3 w-3 fill-current" aria-label="Saved" /> : null}
              {pinned ? <Pin className="h-3 w-3 fill-current" aria-label="Pinned" /> : null}
              <span>{new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(message.createdAt))}</span>
              {message.isMine ? deliveryIcon(message.state) : null}
            </div>
          </div>
        </div>
      </div>

      {liveAggregates.length > 0 ? (
        <div className={cn("-mt-2 mx-2 flex max-w-[90%] flex-wrap gap-1", message.isMine && "justify-end")}>
          {liveAggregates.map((aggregate) => (
            <button
              key={aggregate.reaction}
              type="button"
              onClick={() => showReactors(aggregate)}
              className="focus-ring inline-flex min-h-7 items-center gap-1 rounded-full border border-border/60 bg-card px-2 text-xs font-semibold shadow-sm transition-transform hover:scale-105 active:scale-95 "
              aria-label={`${aggregate.count} ${aggregate.reaction} reactions`}
            >
              <span aria-hidden="true">{reactionEmoji(aggregate.reaction)}</span><span>{aggregate.count}</span>
            </button>
          ))}
        </div>
      ) : myReaction ? <button type="button" onClick={() => react(message.myReaction as string)} className="focus-ring -mt-2 mx-2 grid h-7 min-w-7 place-items-center rounded-full border border-border/60 bg-card px-1.5 text-sm shadow-sm transition-transform hover:scale-110 active:scale-95 ">{myReaction}</button> : null}
    </div>
  );

  return (
    <>
      {actionsOpen ? <button type="button" className="fixed inset-0 z-40 cursor-default bg-black/10 backdrop-blur-[1px] animate-in fade-in duration-150" aria-label="Close message actions" onClick={() => setActionsOpen(false)} /> : null}
      <div className={cn("relative", actionsOpen && "z-50")}>
        {actionsOpen ? (
          <div className={cn("mb-2 flex w-fit max-w-[95vw] items-center gap-0.5 rounded-full border border-border/60 bg-card p-1 shadow-[0_15px_50px_rgba(78,4,1,.18)] animate-in zoom-in-90 slide-in-from-bottom-2 duration-180 ", message.isMine && "ml-auto")}>
            {REACTIONS.map(([id, emoji], index) => (
              <button key={id} type="button" onClick={() => { react(id); setActionsOpen(false); }} className="focus-ring grid h-10 w-10 place-items-center rounded-full text-lg transition-transform hover:scale-125 active:scale-90" style={{ animationDelay: `${index * 18}ms` }} aria-label={`React ${emoji}`}>{emoji}</button>
            ))}
            <button type="button" onClick={() => setActionsOpen(false)} className="grid h-10 w-10 place-items-center rounded-full text-muted-foreground" aria-label="Close"><X className="h-4 w-4" /></button>
          </div>
        ) : null}

        {bubble}

        {actionsOpen ? (
          <div className={cn("mt-2 grid w-[min(330px,92vw)] grid-cols-4 gap-1 rounded-2xl border border-border/60 bg-card p-1.5 shadow-[0_16px_52px_rgba(78,4,1,.18)] animate-in zoom-in-95 slide-in-from-top-1 ", message.isMine && "ml-auto")} role="menu" aria-label="Message actions">
            <Action icon={Reply} label="Reply" onClick={() => { onReply(); setActionsOpen(false); }} />
            <Action icon={Copy} label="Copy" onClick={() => { onCopy(); setActionsOpen(false); }} disabled={!message.text} />
            <Action icon={Bookmark} label={saved ? "Unsave" : "Save"} onClick={() => { onSave(); setActionsOpen(false); }} active={saved} />
            <Action icon={Pin} label={pinned ? "Unpin" : "Pin"} onClick={() => { onPin(); setActionsOpen(false); }} active={pinned} />
            <Action icon={Forward} label="Forward" onClick={() => { onForward(); setActionsOpen(false); }} />
            {message.isMine ? <Action icon={Info} label="Info" onClick={() => { setInfoOpen(true); setActionsOpen(false); }} /> : null}
            {message.isMine && message.text && !message.deleted ? <Action icon={Pencil} label="Edit" onClick={() => { onEdit(); setActionsOpen(false); }} /> : null}
            <Action icon={Trash2} label="Delete" destructive onClick={() => { onDelete(); setActionsOpen(false); }} />
          </div>
        ) : null}
      </div>

      {message.isMine ? <MessageInfoV4 messageId={message.id} open={infoOpen} onOpenChange={setInfoOpen} /> : null}

      <Modal open={Boolean(reactorAggregate)} onOpenChange={(next) => { if (!next) setReactorAggregate(null); }} title={reactorAggregate ? `${reactionEmoji(reactorAggregate.reaction)} Reactions` : "Reactions"} variant="sheet">
        {reactorAggregate ? (
          <div className="pb-[max(.5rem,env(safe-area-inset-bottom))]">
            <div className="mb-3 flex items-center justify-between rounded-2xl bg-primary/10 px-3 py-2 text-xs"><span className="font-semibold">{reactionEmoji(reactorAggregate.reaction)} {reactorAggregate.count}</span><span className="text-muted-foreground">People who reacted</span></div>
            <ul className="divide-y divide-border/45 overflow-hidden rounded-[20px] border border-border/60 bg-card/60">
              {reactorAggregate.reactors.map((person) => (
                <li key={person.userId} className="flex min-h-[62px] items-center gap-3 px-3 py-2.5">
                  <UserAvatar src={person.avatarUrl} name={person.displayName} size="sm" />
                  <div className="min-w-0 flex-1"><strong className="block truncate text-sm">{person.displayName}</strong>{person.username ? <span className="block truncate text-xs text-muted-foreground">@{person.username}</span> : null}</div>
                  <span className="text-lg" aria-hidden="true">{reactionEmoji(reactorAggregate.reaction)}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </Modal>
    </>
  );
}

function Action({ icon: Icon, label, onClick, disabled, active, destructive }: { icon: typeof Reply; label: string; onClick: () => void; disabled?: boolean; active?: boolean; destructive?: boolean }) {
  return (
    <button type="button" role="menuitem" disabled={disabled} onClick={onClick} className={cn("focus-ring flex min-h-14 flex-col items-center justify-center gap-1 rounded-xl px-1 text-xs font-medium transition active:scale-95 disabled:opacity-35", active ? "bg-primary/10 text-primary" : destructive ? "text-destructive hover:bg-destructive/8" : "hover:bg-black/[0.035] dark:hover:bg-white/[0.055]")}>
      <Icon className="h-4 w-4" />
      <span className="truncate">{label}</span>
    </button>
  );
}
