"use client";

import Link from "next/link";
import {
  Bell,
  CheckCheck,
  CircleDollarSign,
  Hand,
  HeartHandshake,
  MapPinOff,
  MessageCircle,
  Send,
  Settings2,
  ShieldAlert,
  UserPlus,
  UsersRound
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useEffect, useMemo, useState, useTransition } from "react";
import { respondToMeetupRequestAction } from "@/app/(app)/premium-actions";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Textarea } from "@/components/ui/textarea";
import { PrivacyToggle } from "@/components/settings/privacy-toggle";
import { connectionResponsesFor } from "@/lib/meetups/connection-prompts";
import { cn } from "@/lib/utils";

type NotificationItem = {
  id: string;
  type: string;
  title: string;
  message: string;
  time: string;
  createdAt: string;
  unread: boolean;
  icon: LucideIcon;
  meetupRequestId: string | null;
};

type ApiNotification = {
  id: string;
  type: string;
  title: string;
  message: string;
  is_read: boolean;
  created_at: string;
};

type NotificationsPageContentProps = {
  canSendCustomMessages?: boolean;
};

export function NotificationsPageContent({
  canSendCustomMessages = false
}: NotificationsPageContentProps) {
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [nearbyAlerts, setNearbyAlerts] = useState(true);
  const [quietMode, setQuietMode] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [selectedRequest, setSelectedRequest] = useState<NotificationItem | null>(null);
  const [filter, setFilter] = useState<"all" | "unread">("all");
  const [feedback, setFeedback] = useState("");
  const [isPending, startTransition] = useTransition();
  const unreadCount = notifications.filter((notification) => notification.unread).length;
  const visibleNotifications = useMemo(
    () => filter === "unread"
      ? notifications.filter((notification) => notification.unread)
      : notifications,
    [filter, notifications]
  );
  const notificationGroups = useMemo(
    () => groupNotificationsByDate(visibleNotifications),
    [visibleNotifications]
  );

  useEffect(() => {
    let isMounted = true;

    async function loadNotifications() {
      try {
        const response = await fetch("/api/notifications", {
          credentials: "include",
          cache: "no-store"
        });

        if (!response.ok) {
          setFeedback("Could not load notifications.");
          return;
        }

        const data = (await response.json()) as { notifications: ApiNotification[] };

        if (!isMounted) {
          return;
        }

        setNotifications(data.notifications.map(toNotificationItem));
        window.dispatchEvent(
          new CustomEvent("mad-buddy:notifications-updated", {
            detail: { unreadCount: data.notifications.filter((notification) => !notification.is_read).length }
          })
        );
      } catch {
        if (isMounted) {
          setFeedback("Could not load notifications.");
        }
      }
    }

    const onFocus = () => void loadNotifications();
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void loadNotifications();
    };

    void loadNotifications();
    // 30s cadence while this page is the active view, paused when the tab is
    // hidden; focus/visibility handlers refresh immediately on return.
    const intervalId = window.setInterval(() => {
      if (!document.hidden) void loadNotifications();
    }, 30_000);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      isMounted = false;
      window.clearInterval(intervalId);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  function markAllRead() {
    startTransition(async () => {
      setNotifications((current) =>
        current.map((notification) => ({ ...notification, unread: false }))
      );
      window.dispatchEvent(
        new CustomEvent("mad-buddy:notifications-updated", { detail: { unreadCount: 0 } })
      );

      try {
        const response = await fetch("/api/notifications/read", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({})
        });

        setFeedback(
          response.ok
            ? "All updates marked as read"
            : "Could not mark notifications read."
        );
      } catch {
        setFeedback("Could not mark notifications read.");
      }
    });
  }

  function openNotification(notification: NotificationItem) {
    if (notification.meetupRequestId) {
      setSelectedRequest(notification);
    }

    if (!notification.unread) return;

    const nextUnreadCount = Math.max(0, unreadCount - 1);
    setNotifications((current) =>
      current.map((item) => (item.id === notification.id ? { ...item, unread: false } : item))
    );
    window.dispatchEvent(
      new CustomEvent("mad-buddy:notifications-updated", {
        detail: { unreadCount: nextUnreadCount }
      })
    );

    void fetch("/api/notifications/read", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notificationId: notification.id })
    }).then((response) => {
      if (response.ok) return;
      setNotifications((current) =>
        current.map((item) => (item.id === notification.id ? { ...item, unread: true } : item))
      );
      window.dispatchEvent(
        new CustomEvent("mad-buddy:notifications-updated", {
          detail: { unreadCount }
        })
      );
      setFeedback("Could not mark this notification as read.");
    }).catch(() => {
      setNotifications((current) =>
        current.map((item) => (item.id === notification.id ? { ...item, unread: true } : item))
      );
      window.dispatchEvent(
        new CustomEvent("mad-buddy:notifications-updated", {
          detail: { unreadCount }
        })
      );
      setFeedback("Could not mark this notification as read.");
    });
  }

  return (
    <div className="mx-auto max-w-[1050px] space-y-4 pt-6">
      <section>
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Pulse</h1>
          <div className="flex items-center gap-2">
            {unreadCount > 0 ? (
              <Button type="button" size="sm" variant="outline" onClick={markAllRead} disabled={isPending}>
                <CheckCheck className="h-4 w-4" aria-hidden="true" />
                {isPending ? "Marking..." : "Mark all as read"}
              </Button>
            ) : null}
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={() => setSettingsOpen(true)}
              aria-label="Notification settings"
              title="Notification settings"
            >
              <Settings2 className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>
        </div>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">Updates from your Muddies and account.</p>
      </section>

      {feedback ? (
        <div className="rounded-[1rem] border border-orange-400/20 bg-orange-400/10 p-3 text-sm text-orange-800 dark:text-orange-50">
          {feedback}
        </div>
      ) : null}

      <section>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/70 pb-2">
          <div className="flex gap-1" aria-label="Notification filters">
            <Button type="button" size="sm" variant={filter === "all" ? "secondary" : "ghost"} onClick={() => setFilter("all")}>All</Button>
            <Button type="button" size="sm" variant={filter === "unread" ? "secondary" : "ghost"} onClick={() => setFilter("unread")}>
              {unreadCount > 0 ? `Unread (${unreadCount})` : "Unread"}
            </Button>
          </div>
        </div>

        <div>
          {visibleNotifications.length > 0 ? (
            <div className="space-y-5 pt-6">
              {notificationGroups.map((group) => (
                <section key={group.label} aria-labelledby={`notification-group-${group.key}`}>
                  <h2
                    id={`notification-group-${group.key}`}
                    className="mb-2 text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground"
                  >
                    {group.label}
                  </h2>
                  <div className="space-y-2">
                    {group.notifications.map((notification) => (
                      <NotificationCard
                        key={notification.id}
                        notification={notification}
                        onOpen={() => openNotification(notification)}
                      />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          ) : (
            <InlineEmptyState
              title={filter === "unread" ? "No unread updates" : "You’re all caught up"}
              description={filter === "unread" ? "You’ve seen everything for now." : "New updates will appear here."}
            />
          )}
        </div>
      </section>

      <Modal
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        title="Notification settings"
        description="Choose which nearby updates you want to receive."
      >
        <div className="grid gap-3">
          <PrivacyToggle
            icon={MapPinOff}
            title="Nearby alerts"
            description="Get occasional alerts when approved friends are nearby."
            checked={nearbyAlerts}
            onCheckedChange={(checked) => {
              setNearbyAlerts(checked);
              if (checked) setQuietMode(false);
            }}
          />
          <PrivacyToggle
            icon={Bell}
            title="Pause nearby alerts"
            description="Pause nearby alerts without missing account updates."
            checked={quietMode}
            onCheckedChange={(checked) => {
              setQuietMode(checked);
              if (checked) setNearbyAlerts(false);
            }}
          />
          <Link
            href="/meeting-pings"
            onClick={() => setSettingsOpen(false)}
            className="focus-ring safe-motion flex min-h-[4.25rem] items-center gap-3 px-2 py-3 text-sm font-semibold text-foreground hover:bg-secondary/40"
          >
            <Hand className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
            Plan alerts
          </Link>
        </div>
      </Modal>

      <Modal
        open={Boolean(selectedRequest)}
        onOpenChange={(open) => {
          if (!open) setSelectedRequest(null);
        }}
        title={selectedRequest ? connectionModalTitle(selectedRequest.title) : "Connection options"}
        description="Choose a reply or ask a question."
        compact
      >
        {selectedRequest ? (
          <ConnectionResponses
            message={selectedRequest.message}
            disabled={isPending}
            canSendCustomMessages={canSendCustomMessages}
            onSelect={(message) => {
              const requestId = selectedRequest.meetupRequestId;
              if (!requestId) return;
              startTransition(async () => {
                  const result = await respondToMeetupRequestAction({ requestId, message });
                  setFeedback(result.ok ? "Reply sent" : "Couldn’t send your reply. Try again.");
                  if (result.ok) setSelectedRequest(null);
              });
            }}
          />
        ) : null}
      </Modal>
    </div>
  );
}

function ConnectionResponses({
  message,
  disabled,
  canSendCustomMessages,
  onSelect
}: {
  message: string;
  disabled: boolean;
  canSendCustomMessages: boolean;
  onSelect: (message: string) => void;
}) {
  const responses = connectionResponsesFor(message);
  const [customMessage, setCustomMessage] = useState("");
  const trimmedMessage = customMessage.trim();

  return (
    <div className="space-y-3">
      <ResponseGroup title="Quick replies" responses={responses.quickReplies} disabled={disabled} onSelect={onSelect} />
      <ResponseGroup title="Ask" responses={responses.followUps} disabled={disabled} onSelect={onSelect} />
      <section className="border-t border-border/70 pt-3">
        <div className="mb-2 flex items-center justify-between gap-3">
          <h3 className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Write a message
          </h3>
          <span className="text-[11px] font-medium text-primary">Buddy Plus</span>
        </div>
        {canSendCustomMessages ? (
          <form
            className="space-y-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (trimmedMessage.length < 2 || trimmedMessage.length > 180) return;
              onSelect(trimmedMessage);
            }}
          >
            <Textarea
              value={customMessage}
              onChange={(event) => setCustomMessage(event.target.value)}
              placeholder="Type a short message"
              minLength={2}
              maxLength={180}
              rows={2}
              className="min-h-20"
              disabled={disabled}
              aria-label="Write a message"
            />
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs text-muted-foreground">
                {customMessage.length}/180 characters
              </span>
              <Button
                type="submit"
                size="sm"
                disabled={disabled || trimmedMessage.length < 2 || trimmedMessage.length > 180}
              >
                <Send className="h-4 w-4" aria-hidden="true" />
                Send
              </Button>
            </div>
          </form>
        ) : (
          <div className="flex flex-col gap-2 rounded-xl bg-secondary/55 p-3 text-sm sm:flex-row sm:items-center sm:justify-between">
            <p className="text-muted-foreground">Custom messages are available with Buddy Plus or Buddy Pro.</p>
            <Button type="button" size="sm" variant="outline" asChild>
              <Link href="/billing">View plans</Link>
            </Button>
          </div>
        )}
      </section>
      <p className="pt-0.5 text-xs text-muted-foreground">No exact location is shared.</p>
    </div>
  );
}

function ResponseGroup({
  title,
  responses,
  disabled,
  onSelect
}: {
  title: string;
  responses: readonly string[];
  disabled: boolean;
  onSelect: (message: string) => void;
}) {
  return (
    <section>
      <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">{title}</h3>
      <div className="grid gap-2 sm:grid-cols-2">
        {responses.map((response) => (
          <Button
            key={response}
            type="button"
            variant="outline"
            className="h-9 min-h-9 justify-start whitespace-normal px-3 text-left text-sm"
            disabled={disabled}
            onClick={() => onSelect(response)}
          >
            {response}
          </Button>
        ))}
      </div>
    </section>
  );
}

function connectionModalTitle(title: string) {
  return title
    .replace(/ sent you a connection prompt$/i, " wants to connect")
    .replace(/ says hello$/i, " wants to connect")
    .replace(/ replied$/i, " wants to connect");
}

/** Notification titles interpolate a profile's stored full_name verbatim,
 * some accounts have that saved in lowercase. Capitalising once here, at the
 * point every notification enters the page's state, fixes display
 * everywhere the title is shown (card, unread dot context, reply modal)
 * without rewriting the stored value or every creation call site. */
function capitalize(text: string): string {
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

type NotificationCardProps = {
  notification: NotificationItem;
  onOpen: () => void;
};

function NotificationCard({ notification, onOpen }: NotificationCardProps) {
  const actionable = Boolean(notification.meetupRequestId);
  const interactive = actionable || notification.unread;
  const isMuddyActivity = isMuddyActivityType(notification.type);
  return (
    <article
      className={cn(
        "flex min-h-[80px] items-start gap-3 rounded-xl border-b border-border/60 px-2 py-3 last:border-b-0",
        interactive && "cursor-pointer transition-colors hover:bg-secondary/50"
      )}
      onClick={interactive ? onOpen : undefined}
      onKeyDown={interactive ? (event) => {
        if (event.key === "Enter" || event.key === " ") onOpen();
      } : undefined}
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
    >
      <div
        className={cn(
          "mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
          isMuddyActivity ? "bg-primary/10 text-primary" : "bg-secondary text-muted-foreground"
        )}
      >
        <notification.icon className="h-4 w-4" aria-hidden="true" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <h3 className="truncate text-sm font-semibold">{notification.title}</h3>
          {notification.unread ? (
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" aria-label="Unread" />
          ) : null}
        </div>
        {notification.message ? (
          <p className="mt-0.5 truncate text-xs text-muted-foreground">{notification.message}</p>
        ) : null}
        {actionable ? <p className="mt-1 text-xs font-medium text-primary">Reply</p> : null}
      </div>
      <span className="mt-0.5 shrink-0 text-[11px] text-muted-foreground">{notification.time}</span>
    </article>
  );
}

function InlineEmptyState({ title, description }: { title: string; description: string }) {
  return (
    <section className="flex items-center gap-3 px-2 pb-2 pt-6 text-left" aria-labelledby="empty-notifications-heading">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-secondary text-muted-foreground">
        <Bell className="h-4 w-4" aria-hidden="true" />
      </div>
      <div>
        <h2 id="empty-notifications-heading" className="font-semibold">{title}</h2>
        <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
      </div>
    </section>
  );
}

function toNotificationItem(notification: ApiNotification): NotificationItem {
  const meetupRequestId = notification.type.startsWith("meetup_request:")
    ? notification.type.slice("meetup_request:".length)
    : null;
  return {
    id: notification.id,
    type: notification.type,
    title: capitalize(notification.title),
    message: notification.message,
    time: formatNotificationTime(notification.created_at),
    createdAt: notification.created_at,
    unread: !notification.is_read,
    icon: iconForType(notification.type),
    meetupRequestId
  };
}

function groupNotificationsByDate(notifications: NotificationItem[]) {
  const groups = new Map<string, { key: string; label: string; notifications: NotificationItem[] }>();

  notifications.forEach((notification) => {
    const date = new Date(notification.createdAt);
    const key = Number.isNaN(date.getTime()) ? "unknown" : date.toISOString().slice(0, 10);
    const label = formatNotificationDate(date);
    const group = groups.get(key);

    if (group) {
      group.notifications.push(notification);
    } else {
      groups.set(key, { key: key.replaceAll("-", ""), label, notifications: [notification] });
    }
  });

  return Array.from(groups.values());
}

function formatNotificationDate(date: Date) {
  if (Number.isNaN(date.getTime())) return "Earlier";

  const today = new Date();
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const startOfDate = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const dayDifference = Math.round((startOfToday - startOfDate) / 86_400_000);

  if (dayDifference === 0) return "Today";
  if (dayDifference === 1) return "Yesterday";

  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: date.getFullYear() === today.getFullYear() ? undefined : "numeric"
  }).format(date);
}

function iconForType(type: string): LucideIcon {
  const iconsByType: Record<string, LucideIcon> = {
    friend_request_received: UserPlus,
    friend_request_accepted: CheckCheck,
    friend_nearby: MapPinOff,
    best_buddy_nearby: HeartHandshake,
    circle_nearby: UsersRound,
    meetup_request: MessageCircle,
    wave: Hand,
    subscription_update: CircleDollarSign,
    system_alert: ShieldAlert
  };

  return iconsByType[type.split(":")[0]] ?? Bell;
}

const MUDDY_ACTIVITY_TYPES = new Set([
  "friend_request_received",
  "friend_request_accepted",
  "friend_nearby",
  "best_buddy_nearby",
  "circle_nearby",
  "meetup_request",
  "wave"
]);

/** Orange is reserved for Muddy activity and proximity, billing/system
 * notifications get a neutral icon treatment instead. */
function isMuddyActivityType(type: string): boolean {
  return MUDDY_ACTIVITY_TYPES.has(type.split(":")[0]);
}

function formatNotificationTime(createdAt: string) {
  const ageMinutes = Math.max(0, Math.floor((Date.now() - new Date(createdAt).getTime()) / 60000));

  if (ageMinutes < 1) {
    return "Just now";
  }

  if (ageMinutes < 60) {
    return `${ageMinutes} min ago`;
  }

  const ageHours = Math.floor(ageMinutes / 60);

  if (ageHours < 24) {
    return `${ageHours} hr ago`;
  }

  return `${Math.floor(ageHours / 24)} days ago`;
}
