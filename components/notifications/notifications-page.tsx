"use client";

import Link from "next/link";
import {
  AlertTriangle,
  Bell,
  CalendarCheck2,
  Check,
  CheckCheck,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleDollarSign,
  Hand,
  HeartHandshake,
  ListChecks,
  MapPinOff,
  MessageCircle,
  Send,
  Settings2,
  ShieldAlert,
  UserPlus,
  UsersRound,
  X
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import * as Popover from "@radix-ui/react-popover";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { respondToMeetupRequestAction } from "@/app/(app)/premium-actions";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Textarea } from "@/components/ui/textarea";
import { PrivacyToggle } from "@/components/settings/privacy-toggle";
import { connectionResponsesFor } from "@/lib/meetups/connection-prompts";
import {
  resolveNotificationDestination,
  type NotificationDestination
} from "@/lib/notifications/destination";
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

type FilterValue = "all" | "unread" | "read";

const FILTER_OPTIONS: Array<{ value: FilterValue; label: string }> = [
  { value: "all", label: "All updates" },
  { value: "unread", label: "Unread" },
  { value: "read", label: "Read" }
];

export function NotificationsPageContent({
  canSendCustomMessages = false
}: NotificationsPageContentProps) {
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [nearbyAlerts, setNearbyAlerts] = useState(true);
  const [quietMode, setQuietMode] = useState(false);
  const [planAlerts, setPlanAlerts] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [selectedRequest, setSelectedRequest] = useState<NotificationItem | null>(null);
  const [filter, setFilter] = useState<FilterValue>("all");
  const [filterOpen, setFilterOpen] = useState(false);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [actionsOpen, setActionsOpen] = useState(false);
  const [toast, setToast] = useState<{ message: string; error: boolean } | null>(null);
  const [feedback, setFeedback] = useState("");
  const [isPending, startTransition] = useTransition();
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unreadCount = notifications.filter((notification) => notification.unread).length;
  const visibleNotifications = useMemo(
    () =>
      filter === "unread"
        ? notifications.filter((notification) => notification.unread)
        : filter === "read"
          ? notifications.filter((notification) => !notification.unread)
          : notifications,
    [filter, notifications]
  );

  const selectedItems = useMemo(
    () => notifications.filter((notification) => selectedIds.has(notification.id)),
    [notifications, selectedIds]
  );
  const selectedCount = selectedItems.length;
  const allSelectedRead = selectedCount > 0 && selectedItems.every((item) => !item.unread);
  const allSelectedUnread = selectedCount > 0 && selectedItems.every((item) => item.unread);
  const allVisibleSelected =
    visibleNotifications.length > 0 && visibleNotifications.every((item) => selectedIds.has(item.id));

  const showToast = useCallback((message: string, error = false) => {
    setToast({ message, error });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3500);
  }, []);
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

  useEffect(() => {
    return () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
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

  // Opening a meetup request is an in-place action (reply modal), not a route.
  function openMeetupRequest(notification: NotificationItem) {
    setSelectedRequest(notification);
    markNotificationRead(notification);
  }

  // Read-state only: used both by the reply-modal action above and by the
  // deep-link rows (which navigate via a real <Link> after this fires).
  function markNotificationRead(notification: NotificationItem) {
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

  function toggleSelected(id: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function exitSelection() {
    setSelectionMode(false);
    setSelectedIds(new Set());
    setActionsOpen(false);
  }

  function selectAllVisible() {
    setSelectedIds(new Set(visibleNotifications.map((item) => item.id)));
  }

  // Bulk read/unread through the existing read-state endpoint (extended
  // additively to accept an id set and an explicit isRead). Optimistic, with
  // rollback and the shared unread-count broadcast.
  function applyBulkRead(isRead: boolean) {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    const idSet = new Set(ids);
    const previous = notifications;

    const next = notifications.map((item) =>
      idSet.has(item.id) ? { ...item, unread: !isRead } : item
    );
    setNotifications(next);
    window.dispatchEvent(
      new CustomEvent("mad-buddy:notifications-updated", {
        detail: { unreadCount: next.filter((item) => item.unread).length }
      })
    );
    setSelectedIds(new Set());
    setActionsOpen(false);

    startTransition(async () => {
      try {
        const response = await fetch("/api/notifications/read", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids, isRead })
        });
        if (!response.ok) throw new Error("bulk update failed");
        showToast(isRead ? "Updates marked as read" : "Updates marked as unread");
      } catch {
        setNotifications(previous);
        window.dispatchEvent(
          new CustomEvent("mad-buddy:notifications-updated", {
            detail: { unreadCount: previous.filter((item) => item.unread).length }
          })
        );
        showToast("Couldn’t update these notifications. Try again.", true);
      }
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
            <Popover.Root open={settingsOpen} onOpenChange={setSettingsOpen}>
              <Popover.Trigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  aria-label="Notification settings"
                  title="Notification settings"
                >
                  <Settings2 className="h-4 w-4" aria-hidden="true" />
                </Button>
              </Popover.Trigger>
              <Popover.Portal>
                <Popover.Content
                  align="end"
                  sideOffset={8}
                  collisionPadding={12}
                  className="z-50 w-[min(320px,calc(100vw-1.5rem))] rounded-2xl border border-border/70 bg-card p-2 shadow-lg outline-none"
                >
                  <p className="px-2 pb-1 pt-1.5 text-sm font-semibold">Notification settings</p>
                  <div className="grid gap-0.5">
                    <PrivacyToggle
                      icon={MapPinOff}
                      title="Nearby alerts"
                      description="Get occasional alerts when approved Muddies are nearby."
                      checked={nearbyAlerts}
                      onCheckedChange={(checked) => {
                        setNearbyAlerts(checked);
                        // Nothing to quiet once nearby alerts are off; clear it
                        // so the two can never sit in a contradictory state.
                        if (!checked) setQuietMode(false);
                      }}
                    />
                    <PrivacyToggle
                      icon={Bell}
                      title="Quiet nearby alerts"
                      description="Temporarily silence nearby alerts."
                      checked={quietMode}
                      disabled={!nearbyAlerts}
                      onCheckedChange={setQuietMode}
                    />
                    <PrivacyToggle
                      icon={CalendarCheck2}
                      title="Plan alerts"
                      description="Get updates about invitations, changes, and reminders."
                      checked={planAlerts}
                      onCheckedChange={setPlanAlerts}
                    />
                  </div>
                </Popover.Content>
              </Popover.Portal>
            </Popover.Root>
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
          {/* Filter dropdown: trigger always shows the active filter. */}
          <Popover.Root open={filterOpen} onOpenChange={setFilterOpen}>
            <Popover.Trigger asChild>
              <Button type="button" size="sm" variant="outline" aria-label="Filter updates">
                {FILTER_OPTIONS.find((option) => option.value === filter)?.label}
                {filter === "unread" && unreadCount > 0 ? ` (${unreadCount})` : ""}
                <ChevronDown className="h-4 w-4" aria-hidden="true" />
              </Button>
            </Popover.Trigger>
            <Popover.Portal>
              <Popover.Content
                align="start"
                sideOffset={8}
                collisionPadding={12}
                className="z-50 w-[min(190px,calc(100vw-1.5rem))] rounded-xl border border-border/70 bg-card p-1 shadow-lg outline-none"
              >
                {FILTER_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    role="menuitemradio"
                    aria-checked={filter === option.value}
                    onClick={() => {
                      setFilter(option.value);
                      setFilterOpen(false);
                    }}
                    className="focus-ring flex min-h-[40px] w-full items-center justify-between gap-2 rounded-lg px-3 text-sm hover:bg-secondary/60"
                  >
                    <span className={cn(filter === option.value && "font-medium text-primary")}>{option.label}</span>
                    {filter === option.value ? <Check className="h-4 w-4 text-primary" aria-hidden="true" /> : null}
                  </button>
                ))}
              </Popover.Content>
            </Popover.Portal>
          </Popover.Root>

          {/* Bulk selection control. */}
          {selectionMode ? (
            <div className="flex items-center gap-1.5">
              <Popover.Root
                open={actionsOpen && selectedCount > 0}
                onOpenChange={(open) => setActionsOpen(open)}
              >
                <Popover.Trigger asChild>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    aria-label={selectedCount > 0 ? `Bulk actions, ${selectedCount} selected` : "Select updates"}
                    onClick={(event) => {
                      // With nothing selected there are no actions to show, so
                      // the trigger just leaves selection mode instead.
                      if (selectedCount === 0) {
                        event.preventDefault();
                        exitSelection();
                      }
                    }}
                  >
                    <ListChecks className="h-4 w-4" aria-hidden="true" />
                    <span aria-live="polite">{selectedCount > 0 ? `${selectedCount} selected` : "Select"}</span>
                  </Button>
                </Popover.Trigger>
                <Popover.Portal>
                  <Popover.Content
                    align="end"
                    sideOffset={8}
                    collisionPadding={12}
                    className="z-50 w-[min(210px,calc(100vw-1.5rem))] rounded-xl border border-border/70 bg-card p-1 shadow-lg outline-none"
                  >
                    {!allVisibleSelected ? (
                      <BulkMenuItem label="Select all" onClick={() => selectAllVisible()} />
                    ) : null}
                    <BulkMenuItem
                      label="Mark as read"
                      disabled={allSelectedRead}
                      onClick={() => applyBulkRead(true)}
                    />
                    <BulkMenuItem
                      label="Mark as unread"
                      disabled={allSelectedUnread}
                      onClick={() => applyBulkRead(false)}
                    />
                    <div className="my-1 border-t border-border/70" />
                    <BulkMenuItem
                      label="Clear selection"
                      onClick={() => {
                        setSelectedIds(new Set());
                        setActionsOpen(false);
                      }}
                    />
                  </Popover.Content>
                </Popover.Portal>
              </Popover.Root>
              <Button type="button" size="sm" variant="ghost" onClick={exitSelection}>
                Done
              </Button>
            </div>
          ) : (
            <Button type="button" size="sm" variant="outline" onClick={() => setSelectionMode(true)}>
              <ListChecks className="h-4 w-4" aria-hidden="true" />
              Select
            </Button>
          )}
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
                        destination={resolveNotificationDestination(notification.type)}
                        selectionMode={selectionMode}
                        selected={selectedIds.has(notification.id)}
                        onToggleSelect={() => toggleSelected(notification.id)}
                        onActivate={() =>
                          notification.meetupRequestId
                            ? openMeetupRequest(notification)
                            : markNotificationRead(notification)
                        }
                      />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          ) : (
            <InlineEmptyState
              title={
                filter === "unread"
                  ? "No unread updates"
                  : filter === "read"
                    ? "No read updates"
                    : "You’re all caught up"
              }
              description={
                filter === "unread"
                  ? "You’ve seen everything for now."
                  : filter === "read"
                    ? "Updates you’ve read will appear here."
                    : "New updates will appear here."
              }
            />
          )}
        </div>
      </section>

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

      {toast ? (
        <div
          role="status"
          aria-live="polite"
          className="toast-in fixed bottom-[calc(88px+env(safe-area-inset-bottom))] left-1/2 z-50 w-[calc(100%-2rem)] max-w-[320px] -translate-x-1/2 md:bottom-6"
        >
          <div className="flex items-start gap-2.5 rounded-xl border border-white/10 bg-[#1b1b1d] px-4 py-3 text-white shadow-lg">
            {toast.error ? (
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" aria-hidden="true" />
            ) : (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" aria-hidden="true" />
            )}
            <p className="min-w-0 flex-1 text-sm">{toast.message}</p>
            <button
              type="button"
              onClick={() => setToast(null)}
              aria-label="Dismiss notification"
              className="focus-ring -mr-1 shrink-0 rounded text-white/50 hover:text-white"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </div>
      ) : null}
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
  destination: NotificationDestination;
  selectionMode: boolean;
  selected: boolean;
  onToggleSelect: () => void;
  onActivate: () => void;
};

function NotificationCard({
  notification,
  destination,
  selectionMode,
  selected,
  onToggleSelect,
  onActivate
}: NotificationCardProps) {
  const actionable = Boolean(notification.meetupRequestId);
  const isMuddyActivity = isMuddyActivityType(notification.type);
  // Three mutually exclusive shapes: an in-place reply (button), a deep link
  // (anchor), or a static informational row. meetup_request never has a
  // resolver destination, so these never collide.
  const isLink = !actionable && destination !== null;
  const clickable = actionable || isLink;

  const body = (
    <>
      {selectionMode ? (
        <span
          className={cn(
            "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center self-center rounded-md border",
            selected ? "border-primary bg-primary text-white" : "border-border bg-transparent"
          )}
          aria-hidden="true"
        >
          {selected ? <Check className="h-3.5 w-3.5" /> : null}
        </span>
      ) : null}
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
      {isLink && !selectionMode ? (
        <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 self-center text-muted-foreground" aria-hidden="true" />
      ) : null}
    </>
  );

  const baseClass =
    "flex min-h-[80px] items-start gap-3 rounded-xl border-b border-border/60 px-2 py-3 last:border-b-0";
  const interactiveClass =
    "focus-ring cursor-pointer text-left transition-colors hover:bg-secondary/50 active:bg-secondary/70";

  // Selection mode wins: the whole row toggles selection (checkbox semantics),
  // and no navigation happens until selection mode is closed.
  if (selectionMode) {
    return (
      <button
        type="button"
        role="checkbox"
        aria-checked={selected}
        aria-label={`Select: ${notification.title}`}
        onClick={onToggleSelect}
        className={cn(baseClass, interactiveClass, "w-full")}
      >
        {body}
      </button>
    );
  }

  if (isLink && destination) {
    return (
      <Link
        href={destination.href}
        onClick={onActivate}
        aria-label={`Open: ${notification.title}`}
        className={cn(baseClass, interactiveClass)}
      >
        {body}
      </Link>
    );
  }

  if (actionable) {
    return (
      <button
        type="button"
        onClick={onActivate}
        aria-label={`Reply to ${notification.title}`}
        className={cn(baseClass, interactiveClass, "w-full")}
      >
        {body}
      </button>
    );
  }

  return <article className={cn(baseClass, !clickable && "cursor-default")}>{body}</article>;
}

function BulkMenuItem({
  label,
  onClick,
  disabled = false
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "focus-ring flex min-h-[40px] w-full items-center rounded-lg px-3 text-left text-sm",
        disabled ? "cursor-not-allowed text-muted-foreground/50" : "hover:bg-secondary/60"
      )}
    >
      {label}
    </button>
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
