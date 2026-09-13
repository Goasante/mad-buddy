/**
 * The transport seam for the shared Notifications screen.
 *
 * The screen renders and manages state; it does NOT know how bytes reach the
 * server. That distinction is what lets one component serve both apps, because
 * the two authenticate completely differently:
 *
 *   web      same-origin relative paths, session cookies
 *   Android  absolute URLs against VITE_API_BASE_URL, Bearer access token
 *
 * A component that fetched directly would hardcode the web assumption, and on
 * Android every relative path resolves against https://localhost -- the bundled
 * asset origin, which serves no API at all. That is not a hypothetical: it is
 * exactly how the whole API layer broke when the production domain moved.
 *
 * Every method resolves rather than throwing. Callers render a message on
 * failure and roll optimistic state back; an exception crossing this boundary
 * would take a working screen down with it.
 */

export type NotificationRecord = {
  id: string;
  type: string;
  title: string;
  message: string;
  is_read: boolean;
  created_at: string;
  previewOnly?: boolean;
};

/** Whether the write happened. `message` is shown to the person when present. */
export type NotificationWriteResult = {
  ok: boolean;
  message?: string;
};

/**
 * A delete reports WHICH ids went, not merely that the call succeeded.
 *
 * The screen removes rows optimistically and restores them when the server
 * disagrees. A bare ok/failed answer cannot distinguish "all five deleted" from
 * "two deleted, three silently skipped", so a partial delete would leave the
 * list permanently disagreeing with the database until a reload.
 */
export type NotificationDeleteResult = {
  ok: boolean;
  deletedIds: string[];
};

export type NotificationsClient = {
  /** Newest first. Resolves null when the list could not be loaded. */
  load(): Promise<NotificationRecord[] | null>;

  /** Marks everything read. */
  markAllRead(): Promise<NotificationWriteResult>;

  /** Marks one row read, used when opening a notification. */
  markRead(notificationId: string): Promise<NotificationWriteResult>;

  /** Marks a selection read or unread. */
  setReadState(ids: string[], isRead: boolean): Promise<NotificationWriteResult>;

  /** Deletes a selection; reports exactly which ids were removed. */
  remove(ids: string[]): Promise<NotificationDeleteResult>;

  /**
   * Replies to a meeting ping.
   *
   * Both platforms reach lib/meetups/service.ts -- web through
   * respondToMeetupRequestAction, Android through /api/pings/respond -- so the
   * premium gate, friendship check and notification delivery are one
   * implementation, not two that resemble each other.
   */
  respondToPing(requestId: string, message: string): Promise<NotificationWriteResult>;

  /** Sends a birthday wish. Web uses its Server Action; Android POSTs /api/birthdays/wish. */
  sendBirthdayWish(targetUserId: string, wish: string): Promise<NotificationWriteResult>;

  /**
   * Saves one or more quick-settings toggles.
   *
   * Both platforms reach lib/settings/service.ts, which merges only the keys
   * present -- so a partial patch never clears the others. The web screen used
   * to hold these three switches in local state alone: flipping one and
   * reloading silently reverted it, while the native app had been persisting
   * them correctly all along. Sharing the screen is what makes that
   * discrepancy impossible to keep.
   */
  saveNotificationPreferences(patch: NotificationPreferences): Promise<NotificationWriteResult>;
};

/**
 * The three quick-settings toggles, as stored.
 *
 * Partial by design: the service merges what it is given, so a single flipped
 * switch sends one key rather than restating the other two and risking
 * clobbering a change made elsewhere.
 */
export type NotificationPreferences = {
  nearbyAlerts?: boolean;
  quietNearby?: boolean;
  planAlerts?: boolean;
};
