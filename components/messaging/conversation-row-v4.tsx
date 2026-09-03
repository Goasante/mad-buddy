"use client";

import { BellOff, Mail, Star, Archive, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { UserAvatar } from "@/components/ui/user-avatar";
import type { ConversationView } from "@/lib/messaging/mobile";
import { cn, formatRelativeTime } from "@/lib/utils";

const ACTION_THRESHOLD = 66;
const SECONDARY_THRESHOLD = 122;
const MAX_DRAG = 146;
const LONG_PRESS_MS = 480;

function haptic(pattern: number | number[]) {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    // Optional in browsers/PWAs.
  }
}

export function ConversationRowV4({
  conversation,
  onIntent,
  onOpen,
  onMarkUnread,
  onFavorite,
  onMute,
  onArchive
}: {
  conversation: ConversationView;
  onIntent?: () => void;
  onOpen: () => void;
  onMarkUnread: () => void;
  onFavorite: () => void;
  onMute: () => void;
  onArchive: () => void;
}) {
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const startRef = useRef<{ x: number; y: number; pointerId: number } | null>(null);
  const movedRef = useRef(false);
  const thresholdRef = useRef<string | null>(null);
  const longPressRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function clearLongPress() {
    if (longPressRef.current) clearTimeout(longPressRef.current);
    longPressRef.current = null;
  }

  useEffect(() => () => clearLongPress(), []);

  function begin(event: React.PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    onIntent?.();
    startRef.current = { x: event.clientX, y: event.clientY, pointerId: event.pointerId };
    movedRef.current = false;
    thresholdRef.current = null;
    setDragging(false);
    clearLongPress();
    longPressRef.current = setTimeout(() => {
      if (movedRef.current) return;
      setActionsOpen(true);
      haptic(9);
    }, LONG_PRESS_MS);
  }

  function move(event: React.PointerEvent<HTMLDivElement>) {
    const start = startRef.current;
    if (!start || start.pointerId !== event.pointerId) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (!dragging && Math.abs(dx) < 7 && Math.abs(dy) < 7) return;
    if (!dragging && Math.abs(dy) > Math.abs(dx)) {
      movedRef.current = true;
      clearLongPress();
      return;
    }
    movedRef.current = true;
    clearLongPress();
    setDragging(true);
    const resistance = Math.abs(dx) > MAX_DRAG ? MAX_DRAG + (Math.abs(dx) - MAX_DRAG) * 0.18 : Math.abs(dx);
    const next = Math.sign(dx) * Math.min(MAX_DRAG + 24, resistance);
    setOffset(next);

    const key =
      next >= SECONDARY_THRESHOLD
        ? "favorite"
        : next >= ACTION_THRESHOLD
          ? "unread"
          : next <= -SECONDARY_THRESHOLD
            ? "archive"
            : next <= -ACTION_THRESHOLD
              ? "mute"
              : null;
    if (key !== thresholdRef.current) {
      thresholdRef.current = key;
      if (key) haptic(6);
    }
    if (event.cancelable) event.preventDefault();
  }

  function finish(event: React.PointerEvent<HTMLDivElement>, cancelled = false) {
    const start = startRef.current;
    if (!start || start.pointerId !== event.pointerId) return;
    startRef.current = null;
    clearLongPress();
    const finalOffset = offset;
    setDragging(false);
    setOffset(0);
    if (cancelled) return;
    if (finalOffset >= SECONDARY_THRESHOLD) onFavorite();
    else if (finalOffset >= ACTION_THRESHOLD) onMarkUnread();
    else if (finalOffset <= -SECONDARY_THRESHOLD) onArchive();
    else if (finalOffset <= -ACTION_THRESHOLD) onMute();
  }

  function keyboardOpen() {
    if (movedRef.current) return;
    onOpen();
  }

  return (
    <div className="relative overflow-hidden rounded-[20px]">
      <div aria-hidden="true" className="absolute inset-0 flex items-stretch justify-between overflow-hidden rounded-[20px]">
        <div className="flex min-w-[148px] items-center gap-3 bg-primary/12 pl-4 text-foreground">
          <span className={cn("grid h-9 w-9 place-items-center rounded-full bg-card/90 transition-transform", offset >= ACTION_THRESHOLD && "scale-110")}><Mail className="h-4 w-4" /></span>
          <span className={cn("grid h-9 w-9 place-items-center rounded-full bg-primary text-white transition-transform", offset >= SECONDARY_THRESHOLD && "scale-110")}><Star className="h-4 w-4" /></span>
        </div>
        <div className="flex min-w-[148px] items-center justify-end gap-3 bg-[#4E0401]/8 pr-4 text-foreground">
          <span className={cn("grid h-9 w-9 place-items-center rounded-full bg-card/90 transition-transform", offset <= -ACTION_THRESHOLD && "scale-110")}><BellOff className="h-4 w-4" /></span>
          <span className={cn("grid h-9 w-9 place-items-center rounded-full bg-foreground text-background transition-transform", offset <= -SECONDARY_THRESHOLD && "scale-110")}><Archive className="h-4 w-4" /></span>
        </div>
      </div>

      <div
        role="button"
        tabIndex={0}
        aria-label={`Open chat with ${conversation.title}`}
        onPointerEnter={onIntent}
        onFocus={onIntent}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            keyboardOpen();
          }
        }}
        onClick={() => {
          if (!movedRef.current) onOpen();
          movedRef.current = false;
        }}
        onPointerDown={begin}
        onPointerMove={move}
        onPointerUp={(event) => finish(event)}
        onPointerCancel={(event) => finish(event, true)}
        onContextMenu={(event) => {
          event.preventDefault();
          setActionsOpen(true);
        }}
        className={cn(
          "relative z-10 flex min-h-[76px] touch-pan-y select-none items-center gap-3 rounded-[20px] bg-background px-3 py-2.5 text-left shadow-[0_0_0_1px_hsl(var(--border)/0.45)]",
          !dragging && "transition-transform duration-300 ease-[cubic-bezier(.2,.8,.2,1)]"
        )}
        style={{ transform: `translate3d(${offset}px,0,0)` }}
      >
        <div className="relative shrink-0">
          {/* An inbox row carries no proximity, so it renders a plain avatar
              rather than instantiating a dormant Glow system. Conversation
              membership is not a proximity fact. */}
          <UserAvatar
            name={conversation.title}
            src={conversation.avatarUrl}
            size="sm"
            decorative
            className="border-2 border-background shadow-[inset_0_0_0_1px_hsl(var(--border)),0_8px_24px_hsl(var(--shadow)/0.16)]"
          />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1.5">
            <strong className={cn("truncate text-sm", conversation.unreadCount > 0 ? "font-semibold" : "font-medium")}>{conversation.title}</strong>
            {conversation.pinned ? <Star className="h-3 w-3 shrink-0 fill-[#E88C2B] text-primary" /> : null}
          </div>
          {/* WHAT KIND OF CHAT THIS IS.
              Without this line an Event Room, a Plan Chat and a Group are
              indistinguishable in the inbox -- the projection already carries
              contextBadge ("Event Room" / "Plan" / "Event" / "Safe Arrival")
              and the Room's parent Event name, and nothing was reading them.
              A Room is temporary and belongs to one Event, so the inbox has to
              say which; it is deliberately NOT presented as a Group. */}
          {conversation.contextBadge ? (
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              {conversation.roomEventName
                ? `${conversation.roomEventName} · ${conversation.contextBadge}`
                : conversation.contextBadge}
            </p>
          ) : null}
          <p className={cn("mt-1 truncate text-sm", conversation.unreadCount > 0 ? "font-medium text-foreground/80" : "text-muted-foreground")}>{conversation.lastMessagePreview ?? "No messages yet"}</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5 pl-1">
          <span className={cn("text-xs", conversation.unreadCount > 0 ? "font-semibold text-primary" : "text-muted-foreground")}>{conversation.lastMessageAt ? formatRelativeTime(conversation.lastMessageAt) : ""}</span>
          {conversation.unreadCount > 0 ? <span className="grid h-5 min-w-5 place-items-center rounded-full bg-primary px-1.5 text-xs font-semibold text-primary-foreground transition-transform animate-in zoom-in-75">{conversation.unreadCount > 99 ? "99+" : conversation.unreadCount}</span> : conversation.muted ? <BellOff className="h-3.5 w-3.5 text-muted-foreground" /> : null}
        </div>
      </div>

      {actionsOpen ? (
        <div className="absolute inset-0 z-20 flex items-center justify-end gap-1.5 rounded-[20px] bg-background/95 px-2 shadow-lg backdrop-blur-md animate-in fade-in zoom-in-95" role="toolbar" aria-label={`Actions for ${conversation.title}`}>
          <button type="button" onClick={() => { onMarkUnread(); setActionsOpen(false); }} className="grid h-11 min-w-11 place-items-center rounded-full bg-secondary px-3 text-xs font-semibold"><Mail className="h-4 w-4" /></button>
          <button type="button" onClick={() => { onFavorite(); setActionsOpen(false); }} className="grid h-11 min-w-11 place-items-center rounded-full bg-secondary px-3 text-xs font-semibold"><Star className="h-4 w-4" /></button>
          <button type="button" onClick={() => { onMute(); setActionsOpen(false); }} className="grid h-11 min-w-11 place-items-center rounded-full bg-secondary px-3 text-xs font-semibold"><BellOff className="h-4 w-4" /></button>
          <button type="button" onClick={() => { onArchive(); setActionsOpen(false); }} className="grid h-11 min-w-11 place-items-center rounded-full bg-foreground px-3 text-xs font-semibold text-background"><Archive className="h-4 w-4" /></button>
          <button type="button" onClick={() => setActionsOpen(false)} className="grid h-11 w-11 place-items-center rounded-full text-muted-foreground" aria-label="Close actions"><X className="h-4 w-4" /></button>
        </div>
      ) : null}
    </div>
  );
}
