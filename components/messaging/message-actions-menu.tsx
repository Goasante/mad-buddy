"use client";

import { useState } from "react";
import { AppMenu, type AppMenuItem } from "@/components/ui/app-dropdown";
import { useLongPress } from "@/hooks/use-long-press";
import { haptic } from "@/lib/device/haptics";
import {
  isDestructiveMessageAction,
  MESSAGE_ACTION_LABELS,
  messageActions,
  type MessageActionId,
  type MessageActionSubject
} from "@/lib/messaging/message-actions";

/**
 * Press-and-hold a message for its contextual actions.
 *
 * Wraps a bubble rather than replacing it, so the message keeps its own
 * layout and this only adds the gesture. Uses the app's canonical
 * `useLongPress` (500ms, movement cancels, right-click parity, post-hold
 * click suppression) and `AppMenu`, exactly as the Muddies grid does -- one
 * interaction system, not a second one for chat.
 *
 * A message with no available actions renders no gesture at all: a hold that
 * opens an empty menu is worse than a hold that does nothing.
 */
export function MessageActionsMenu({
  subject,
  nowMs,
  onAction,
  children
}: {
  subject: MessageActionSubject;
  /** Injected so eligibility is deterministic under test. */
  nowMs: number;
  onAction: (action: MessageActionId) => void;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const available = messageActions(subject, nowMs);
  const hasActions = available.length > 0;

  const { pressing, handlers } = useLongPress(
    () => {
      // The hold succeeded: acknowledge it under the finger before the menu
      // paints, so the gesture feels answered rather than merely obeyed.
      haptic("tick");
      setOpen(true);
    },
    { disabled: !hasActions }
  );

  const items: AppMenuItem[] = available.map((action, index) => ({
    id: action,
    label: MESSAGE_ACTION_LABELS[action],
    destructive: isDestructiveMessageAction(action),
    // One rule above the first destructive action, so deletes are visually
    // separated from the safe ones rather than sitting in the same run.
    separatorBefore:
      isDestructiveMessageAction(action) &&
      index > 0 &&
      !isDestructiveMessageAction(available[index - 1]),
    onSelect: () => {
      haptic("select");
      onAction(action);
    }
  }));

  if (!hasActions) return <>{children}</>;

  return (
    <span className="relative block">
      <span
        // A span, not a button: a message bubble contains its own interactive
        // parts (links, voice controls), and nesting those inside a button is
        // invalid and steals their clicks.
        onPointerDown={handlers.onPointerDown}
        onPointerMove={handlers.onPointerMove}
        onPointerUp={handlers.onPointerUp}
        onPointerLeave={handlers.onPointerLeave}
        onPointerCancel={handlers.onPointerCancel}
        onContextMenu={handlers.onContextMenu}
        onClick={handlers.onClick}
        className={pressing ? "block scale-[0.98] transition-transform motion-reduce:transform-none" : "block"}
      >
        {children}
      </span>

      <AppMenu
        open={open}
        onOpenChange={setOpen}
        label="Message actions"
        trigger={<span aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 block h-0" />}
        items={items}
      />
    </span>
  );
}
