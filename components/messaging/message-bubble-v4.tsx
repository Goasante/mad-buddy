"use client";

import { Bookmark, Check, CheckCheck, Copy, Forward, Pin, Reply, Trash2, Pencil, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { ChatPollCard } from "@/components/messaging/chat-poll-card";
import { MessageAttachmentImage } from "@/components/messaging/message-attachment-image";
import { VoiceMessageBubble } from "@/components/messaging/voice-message-bubble";
import { SafeMessageText } from "@/components/messages/safe-message-text";
import { UserAvatar } from "@/components/ui/user-avatar";
import { PremiumPlanBadge } from "@/components/premium/premium-plan-badge";
import { TrustedMemberMark } from "@/components/trust/trusted-member-mark";
import { VerifiedAccountMark } from "@/components/trust/verified-account-mark";
import type { AttachmentView } from "@/lib/messaging/attachments";
import type { ChatMessageView } from "@/lib/messaging/mobile";
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

function haptic(pattern: number | number[]) {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    // Optional in PWA/browser environments.
  }
}

function deliveryIcon(state: string) {
  if (state === "seen") return <CheckCheck className="h-3.5 w-3.5 text-[#E88C2B]" aria-label="Seen" />;
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
  onReply,
  onReact,
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
  onReply: () => void;
  onReact: (reaction: string) => void;
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
  const startRef = useRef<{ x: number; y: number; pointerId: number } | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressedRef = useRef(false);

  function clearTimer() {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
  }

  useEffect(() => () => clearTimer(), []);

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

  const myReaction = REACTIONS.find(([id]) => id === message.myReaction)?.[1] ?? null;
  const bubble = (
    <div className={cn("relative", message.isMine && "flex flex-col items-end", actionsOpen && "z-50") }>
      {showIdentity && !message.isMine && isGroup ? (
        <div className="mb-1 flex max-w-full items-center gap-1.5 px-1 text-[11px] font-semibold text-muted-foreground">
          <UserAvatar src={message.senderAvatarUrl} name={message.senderName} size="xs" decorative />
          <span className="truncate">{message.senderName}</span>
          <PremiumPlanBadge plan={message.senderPlan} compact />
          <TrustedMemberMark trustedSince={message.senderTrustedSince} compact />
          <VerifiedAccountMark isVerifiedAccount={message.senderIsVerifiedAccount} compact />
          {message.senderRole === "owner" || message.senderRole === "admin" ? <span className="font-normal opacity-70">· {message.senderRole === "owner" ? "Owner" : "Admin"}</span> : null}
        </div>
      ) : null}

      <div className="relative">
        <div aria-hidden="true" className={cn("absolute inset-y-0 left-0 grid w-12 place-items-center text-[#E88C2B] transition-opacity", dragX > 14 ? "opacity-100" : "opacity-0")} style={{ transform: "translateX(-42px)" }}>
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
          onDoubleClick={() => onReact("heart")}
          className={cn(
            "touch-pan-y select-none",
            !dragging && "transition-transform duration-300 ease-[cubic-bezier(.2,.8,.2,1)]",
            actionsOpen && "scale-[1.018]"
          )}
          style={{ transform: `translate3d(${dragX}px,0,0)` }}
        >
          <div className={cn(
            "relative overflow-hidden rounded-[21px] px-3.5 py-2.5 text-[0.94rem] leading-[1.42] shadow-[0_1px_2px_rgba(78,4,1,0.07)] transition-[box-shadow,transform,background-color] duration-300",
            message.isMine ? "rounded-br-[7px] bg-[#4E0401] text-[#FEFBF3]" : "rounded-bl-[7px] border border-black/[0.035] bg-white text-foreground dark:border-white/[0.055] dark:bg-white/[0.07]",
            highlighted && "ring-2 ring-[#E88C2B]/70 shadow-[0_0_0_5px_rgba(232,140,43,.08)]",
            actionsOpen && "shadow-[0_16px_44px_rgba(78,4,1,.2)]"
          )}>
            {replyContext ? (
              <button type="button" onClick={onReply} className={cn("mb-2 block w-full rounded-xl border-l-2 border-[#E88C2B] px-2.5 py-1.5 text-left text-xs", message.isMine ? "bg-white/10" : "bg-[#E88C2B]/8")}>
                <strong className={message.isMine ? "text-orange-200" : "text-[#E88C2B]"}>{replyContext.senderName}</strong>
                <span className="mt-0.5 block line-clamp-2 opacity-75">{replyContext.text}</span>
              </button>
            ) : null}

            {!message.deleted && message.attachment ? (
              <MessageAttachmentImage conversationId={conversationId} message={message} onOpen={onOpenMedia} onRefreshed={onAttachmentRefresh} />
            ) : null}
            {!message.deleted && message.voice ? (
              <VoiceMessageBubble conversationId={conversationId} messageId={message.id} senderName={message.isMine ? "you" : message.senderName} asset={message.voice} />
            ) : null}
            {!message.deleted && message.messageType === "poll" && poll ? (
              <ChatPollCard poll={poll} mine={message.isMine} onChanged={onPollChanged} />
            ) : null}
            {message.text ? <SafeMessageText text={message.deleted ? DELETED_MESSAGE_PLACEHOLDER : message.text} mentions={message.mentions} /> : null}
            {message.editedAt && !message.deleted ? <span className={cn("ml-1 text-[10px]", message.isMine ? "text-white/55" : "text-muted-foreground")}>edited</span> : null}
            <div className={cn("mt-1 flex items-center justify-end gap-1 text-[9px] font-medium", message.isMine ? "text-white/55" : "text-muted-foreground/75")}>
              {saved ? <Bookmark className="h-3 w-3 fill-current" aria-label="Saved" /> : null}
              {pinned ? <Pin className="h-3 w-3 fill-current" aria-label="Pinned" /> : null}
              <span>{new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(message.createdAt))}</span>
              {message.isMine ? deliveryIcon(message.state) : null}
            </div>
          </div>
        </div>
      </div>

      {myReaction ? <button type="button" onClick={() => onReact(message.myReaction as string)} className="focus-ring -mt-2 mx-2 grid h-7 min-w-7 place-items-center rounded-full border border-black/[0.06] bg-white px-1.5 text-sm shadow-sm transition-transform hover:scale-110 active:scale-95 dark:border-white/[0.08] dark:bg-[#241f1c]">{myReaction}</button> : null}
    </div>
  );

  return (
    <>
      {actionsOpen ? <button type="button" className="fixed inset-0 z-40 cursor-default bg-black/10 backdrop-blur-[1px] animate-in fade-in duration-150" aria-label="Close message actions" onClick={() => setActionsOpen(false)} /> : null}
      <div className={cn("relative", actionsOpen && "z-50")}>
        {actionsOpen ? (
          <div className={cn("mb-2 flex w-fit max-w-[95vw] items-center gap-0.5 rounded-full border border-black/[0.06] bg-white p-1 shadow-[0_15px_50px_rgba(78,4,1,.18)] animate-in zoom-in-90 slide-in-from-bottom-2 duration-180 dark:border-white/[0.08] dark:bg-[#241f1c]", message.isMine && "ml-auto")}>
            {REACTIONS.map(([id, emoji], index) => (
              <button key={id} type="button" onClick={() => { onReact(id); setActionsOpen(false); }} className="focus-ring grid h-10 w-10 place-items-center rounded-full text-lg transition-transform hover:scale-125 active:scale-90" style={{ animationDelay: `${index * 18}ms` }} aria-label={`React ${emoji}`}>{emoji}</button>
            ))}
            <button type="button" onClick={() => setActionsOpen(false)} className="grid h-10 w-10 place-items-center rounded-full text-muted-foreground" aria-label="Close"><X className="h-4 w-4" /></button>
          </div>
        ) : null}

        {bubble}

        {actionsOpen ? (
          <div className={cn("mt-2 grid w-[min(330px,92vw)] grid-cols-4 gap-1 rounded-2xl border border-black/[0.06] bg-white p-1.5 shadow-[0_16px_52px_rgba(78,4,1,.18)] animate-in zoom-in-95 slide-in-from-top-1 dark:border-white/[0.08] dark:bg-[#241f1c]", message.isMine && "ml-auto")} role="menu" aria-label="Message actions">
            <Action icon={Reply} label="Reply" onClick={() => { onReply(); setActionsOpen(false); }} />
            <Action icon={Copy} label="Copy" onClick={() => { onCopy(); setActionsOpen(false); }} disabled={!message.text} />
            <Action icon={Bookmark} label={saved ? "Unsave" : "Save"} onClick={() => { onSave(); setActionsOpen(false); }} active={saved} />
            <Action icon={Pin} label={pinned ? "Unpin" : "Pin"} onClick={() => { onPin(); setActionsOpen(false); }} active={pinned} />
            <Action icon={Forward} label="Forward" onClick={() => { onForward(); setActionsOpen(false); }} />
            {message.isMine && message.text && !message.deleted ? <Action icon={Pencil} label="Edit" onClick={() => { onEdit(); setActionsOpen(false); }} /> : null}
            <Action icon={Trash2} label="Delete" destructive onClick={() => { onDelete(); setActionsOpen(false); }} />
          </div>
        ) : null}
      </div>
    </>
  );
}

function Action({ icon: Icon, label, onClick, disabled, active, destructive }: { icon: typeof Reply; label: string; onClick: () => void; disabled?: boolean; active?: boolean; destructive?: boolean }) {
  return (
    <button type="button" role="menuitem" disabled={disabled} onClick={onClick} className={cn("focus-ring flex min-h-14 flex-col items-center justify-center gap-1 rounded-xl px-1 text-[10px] font-semibold transition active:scale-95 disabled:opacity-35", active ? "bg-[#E88C2B]/12 text-[#E88C2B]" : destructive ? "text-destructive hover:bg-destructive/8" : "hover:bg-black/[0.035] dark:hover:bg-white/[0.055]")}>
      <Icon className="h-4 w-4" />
      <span className="truncate">{label}</span>
    </button>
  );
}
