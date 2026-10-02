"use client";

import { useCallback, useEffect } from "react";

import { markInboxDeliveredAction } from "@/app/(app)/messaging-delivery-actions";
import { MESSAGE_INSERTED_EVENT } from "@/hooks/use-unread-message-count";

/**
 * A direct-message delivery acknowledgement for an actively connected Messages
 * surface.
 *
 * "Sent" is established by the sender's successful server action. "Delivered"
 * is deliberately a different event: this authenticated recipient session is
 * alive and has received the database change through Realtime (or has just
 * become visible again). Read/Seen remains owned by the individual thread's
 * existing read cursor and read-receipt flow.
 *
 * This component renders nothing. It exists at the /messages boundary so
 * opening Chats is enough to acknowledge incoming direct messages even when
 * the person has not opened that specific thread yet.
 */
export function MessageDeliveryAck() {
  const acknowledge = useCallback(() => {
    void markInboxDeliveredAction().catch(() => {
      // Delivery acknowledgement is additive. A temporary network failure must
      // never block the inbox; the next Realtime/focus/visibility event retries.
    });
  }, []);

  useEffect(() => {
    acknowledge();

    const onFocus = () => acknowledge();
    const onVisibility = () => {
      if (document.visibilityState === "visible") acknowledge();
    };
    const onOnline = () => acknowledge();

    window.addEventListener("focus", onFocus);
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisibility);

    const onIncomingMessage = () => acknowledge();
    window.addEventListener(MESSAGE_INSERTED_EVENT, onIncomingMessage);

    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener(MESSAGE_INSERTED_EVENT, onIncomingMessage);
    };
  }, [acknowledge]);

  return null;
}
