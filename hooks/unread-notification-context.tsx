"use client";

import { createContext, useContext, type ReactNode } from "react";

/**
 * Publishes the shell's already-resolved unread count to pages inside it.
 *
 * The shell mounts exactly one `useUnreadNotificationCount` (seeded from the
 * server on first render, then kept fresh by focus/visibility/poll/broadcast).
 * Any badge surface below reads that value through this context instead of
 * calling the hook again — otherwise every page with a Bell would start a
 * second poller and briefly render 0 before its own first fetch landed.
 *
 * Undefined (no provider) means "unknown", which reads as 0 and simply hides
 * the badge rather than throwing.
 */
const UnreadNotificationContext = createContext<number | undefined>(undefined);

export function UnreadNotificationProvider({
  count,
  children
}: {
  count: number;
  children: ReactNode;
}) {
  return (
    <UnreadNotificationContext.Provider value={count}>{children}</UnreadNotificationContext.Provider>
  );
}

/** The canonical unread count for badge surfaces. 0 when unknown. */
export function useUnreadNotifications(): number {
  return useContext(UnreadNotificationContext) ?? 0;
}
