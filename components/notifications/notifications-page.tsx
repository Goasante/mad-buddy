"use client";

import Link from "next/link";
import {
  AlertTriangle,
  Bell,
  CalendarCheck2,
  Check,
  CheckCheck,
  CheckCircle2,
  ChevronRight,
  CircleDollarSign,
  Hand,
  HeartHandshake,
  ListChecks,
  MapPin,
  MapPinOff,
  Megaphone,
  MessageCircle,
  MoreHorizontal,
  Send,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
  UserPlus,
  UsersRound,
  X
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import * as Popover from "@radix-ui/react-popover";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { respondToMeetupRequestAction } from "@/app/(app)/premium-actions";
import { Button } from "@/components/ui/button";
import { AppMenu } from "@/components/ui/app-dropdown";
import { Modal } from "@/components/ui/modal";
import { Textarea } from "@/components/ui/textarea";
import { PrivacyToggle } from "@/components/settings/privacy-toggle";
import { useDismissOnBack } from "@/hooks/use-dismiss-on-back";
import { connectionResponsesFor } from "@/lib/meetups/connection-prompts";
import { TOUR_TARGET_IDS } from "@/lib/tours/registry";
import {
  resolveNotificationDestination,
  type NotificationDestination
} from "@/lib/notifications/destination";
import { fetchWithTimeout } from "@/lib/network/resilience";
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
  /** Server-fetched first page, so the list renders on first paint instead
   * of behind a client fetch — the client effect below still polls for
   * freshness, this only removes the initial blank/loading shell. */
  initialNotifications?: ApiNotification[];
};

type PulseCategory = "all" | "nearby" | "social" | "plans" | "safety";

const PULSE_CATEGORIES: Array<{ value: PulseCategory; label: string; icon: LucideIcon | null }> = [
  { value: "all", label: "All", icon: null },
  { value: "nearby", label: "Nearby", icon: MapPin },
  { value: "social", label: "Social", icon: UsersRound },
  { value: "plans", label: "Plans", icon: CalendarCheck2 },
  { value: "safety", label: "Safety", icon: ShieldCheck }
];

/** Maps a raw notification type to a Pulse category. Types outside the four
 *  named buckets (billing, support, staff) only surface under "All". */
function categoryForType(type: string): Exclude<PulseCategory, "all"> | "system" {
  const base = type.split(":")[0];
  if (base === "friend_nearby" || base === "best_buddy_nearby" || base === "circle_nearby") return "nearby";
  if (
    base === "wave" ||
    base === "friend_request_received" ||
    base === "friend_request_accepted" ||
    base === "meetup_request" ||
    base === "meeting_ping" ||
    base === "hangout" ||
    base === "moment" ||
    base === "group" ||
    base === "message"
  ) {
    return "social";
  }
  if (base === "plan" || base === "event") return "plans";
  if (base === "safe_arrival" || base === "system_alert") return "safety";
  return "system";
}

function categoryLabel(category: Exclude<PulseCategory, "all">): string {
  return category === "nearby" ? "nearby" : category === "social" ? "social" : category === "plans" ? "plans" : "safety";
}

function categoryEmptyHint(category: Exclude<PulseCategory, "all">): string {
  switch (category) {
    case "nearby":
      return "Muddies glowing nearby will show up here.";
    case "social":
      return "Waves, requests and Moments will show up here.";
    case "plans":
      return "Plan invites and reminders will show up here.";
    case "safety":
      return "Safe Arrival and safety updates will show up here.";
  }
}

/** Per-category accent for the row icon (real, derived from the type). */
function categoryIconClass(category: ReturnType<typeof categoryForType>): string {
  switch (category) {
    case "nearby":
    case "plans":
      return "bg-primary/10 text-primary";
    case "social":
      return "bg-violet-500/12 text-violet-600 dark:text-violet-300";
    case "safety":
      return "bg-sky-500/12 text-sky-600 dark:text-sky-300";
    default:
      return "bg-secondary text-muted-foreground";
  }
}

export function NotificationsPageContent({
  canSendCustomMessages = false,
  initialNotifications = []
}: NotificationsPageContentProps) {
  const [notifications, setNotifications] = useState<NotificationItem[]>(() =>
    initialNotifications.map(toNotificationItem)
  );
  const [nearbyAlerts, setNearbyAlerts] = useState(true);
  const [quietMode, setQuietMode] = useState(false);
  const [planAlerts, setPlanAlerts] = useState(true);
  // Two separate surfaces, deliberately: `optionsOpen` is the lightweight
  // Pulse-management popover (Mark all as read / Select updates), `settingsOpen`
  // is the dedicated Notification settings sheet. Keeping them apart is the
  // whole point of this screen — actions and preferences never compete.
  const [optionsOpen, setOptionsOpen] = useState(false);
  useDismissOnBack(optionsOpen, () => setOptionsOpen(false));
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [selectedRequest, setSelectedRequest] = useState<NotificationItem | null>(null);
  const [category, setCategory] = useState<PulseCategory>("all");
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
      category === "all"
        ? notifications
        : notifications.filter((notification) => categoryForType(notification.type) === category),
    [category, notifications]
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
    let loadInFlight: Promise<void> | null = null;

    function loadNotifications() {
      if (loadInFlight) return loadInFlight;

      loadInFlight = (async () => {
        try {
          const response = await fetchWithTimeout("/api/notifications", {
            credentials: "include",
            cache: "no-store"
          }, 12_000, "load notifications");

          if (!response.ok) {
            if (isMounted) setFeedback("Could not load notifications.");
            return;
          }

          const data = (await response.json()) as { notifications: ApiNotification[] };

          if (!isMounted) return;

          setFeedback("");
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
        } finally {
          loadInFlight = null;
        }
      })();

      return loadInFlight;
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
        const response = await fetchWithTimeout("/api/notifications/read", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({})
        }, 12_000, "mark all notifications read");

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

    void fetchWithTimeout("/api/notifications/read", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notificationId: notification.id })
    }, 12_000, "mark notification read").then((response) => {
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
        const response = await fetchWithTimeout("/api/notifications/read", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids, isRead })
        }, 12_000, "update selected notifications");
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

  function deleteNotifications(ids: string[]) {
    if (ids.length === 0) return;

    const idSet = new Set(ids);
    const previous = notifications;
    const next = notifications.filter((item) => !idSet.has(item.id));
    setNotifications(next);
    setSelectedIds(new Set());
    setActionsOpen(false);
    setSelectionMode(false);
    if (selectedRequest && idSet.has(selectedRequest.id)) setSelectedRequest(null);
    window.dispatchEvent(
      new CustomEvent("mad-buddy:notifications-updated", {
        detail: { unreadCount: next.filter((item) => item.unread).length }
      })
    );

    startTransition(async () => {
      try {
        const response = await fetchWithTimeout("/api/notifications", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids })
        }, 12_000, "delete selected notifications");
        const result = (await response.json().catch(() => null)) as { deletedIds?: string[] } | null;
        const deletedIds = new Set(result?.deletedIds ?? []);
        if (!response.ok || ids.some((id) => !deletedIds.has(id))) {
          throw new Error("delete failed");
        }
        showToast(ids.length === 1 ? "Update deleted" : `${ids.length} updates deleted`);
      } catch {
        setNotifications(previous);
        window.dispatchEvent(
          new CustomEvent("mad-buddy:notifications-updated", {
            detail: { unreadCount: previous.filter((item) => item.unread).length }
          })
        );
        showToast(ids.length === 1 ? "Couldn’t delete this update. Try again." : "Couldn’t delete these updates. Try again.", true);
      }
    });
  }

  return (
    <div className="mx-auto max-w-[1050px] space-y-4 pt-6">
      <section data-tour-id={TOUR_TARGET_IDS.PULSE_OVERVIEW}>
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Pulse</h1>
          <div className="flex items-center gap-2">
            <Popover.Root open={optionsOpen} onOpenChange={setOptionsOpen}>
              <Popover.Trigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="rounded-full"
                  aria-label="Pulse options"
                  title="Pulse options"
                >
                  <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
                </Button>
              </Popover.Trigger>
              <Popover.Portal>
                {/* Management actions only — real notification preferences live
                    in their own sheet (opened from "Notification settings"
                    below), so the two never compete for the same small space. */}
                <Popover.Content
                  align="end"
                  sideOffset={8}
                  collisionPadding={12}
                  className="compact-drop-popover app-dropdown-content w-[min(280px,calc(100vw-1.5rem))] p-1.5"
                >
                  <div className="grid gap-0.5">
                    {unreadCount > 0 ? (
                      <button
                        type="button"
                        onClick={() => {
                          markAllRead();
                          setOptionsOpen(false);
                        }}
                        disabled={isPending}
                        className="focus-ring flex items-center gap-2.5 rounded-lg px-2.5 py-2.5 text-left text-sm hover:bg-secondary disabled:opacity-60"
                      >
                        <CheckCheck className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                        {isPending ? "Marking…" : "Mark all as read"}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => {
                        setSelectionMode(true);
                        setOptionsOpen(false);
                      }}
                      className="focus-ring flex items-center gap-2.5 rounded-lg px-2.5 py-2.5 text-left text-sm hover:bg-secondary"
                    >
                      <ListChecks className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                      Select updates
                    </button>
                    <div className="my-0.5 border-t border-border/60" aria-hidden="true" />
                    <button
                      type="button"
                      onClick={() => {
                        setOptionsOpen(false);
                        setSettingsOpen(true);
                      }}
                      className="focus-ring flex items-center gap-2.5 rounded-lg px-2.5 py-2.5 text-left text-sm hover:bg-secondary"
                    >
                      <SlidersHorizontal className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                      Notification settings
                    </button>
                  </div>
                </Popover.Content>
              </Popover.Portal>
            </Popover.Root>

            {/* A real bottom sheet — solid surface + dimmed backdrop, not a
                floating menu — so it reads as its own interaction layer rather
                than a translucent panel Pulse content stays visible through.
                Tap-outside and Android back both dismiss it (built into
                Modal's sheet variant). */}
            <Modal
              open={settingsOpen}
              onOpenChange={setSettingsOpen}
              title="Notification settings"
              description="Choose which updates can alert you."
              variant="sheet"
              compact
            >
              <div className="divide-y divide-border/60">
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
                  description="Get updates about plans and invitations."
                  checked={planAlerts}
                  onCheckedChange={setPlanAlerts}
                />
              </div>
            </Modal>
          </div>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">What&apos;s happening with your Muddies.</p>
      </section>

      {feedback ? (
        <div className="rounded-[1rem] border border-orange-400/20 bg-orange-400/10 p-3 text-sm text-orange-800 dark:text-orange-50">
          {feedback}
        </div>
      ) : null}

      <section>
        {selectionMode ? (
          // Bulk-selection toolbar replaces the category chips while active.
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/70 pb-2">
            {selectedCount > 0 ? (
              <AppMenu
                open={actionsOpen}
                onOpenChange={setActionsOpen}
                label="Selected update actions"
                trigger={
                  <Button type="button" size="sm" variant="outline" aria-label={`Bulk actions, ${selectedCount} selected`}>
                    <ListChecks className="h-4 w-4" aria-hidden="true" />
                    <span aria-live="polite">{selectedCount} selected</span>
                  </Button>
                }
                items={[
                  ...(!allVisibleSelected ? [{ id: "select-all", label: "Select all", onSelect: selectAllVisible }] : []),
                  { id: "mark-read", label: "Mark as read", disabled: allSelectedRead, onSelect: () => applyBulkRead(true) },
                  { id: "mark-unread", label: "Mark as unread", disabled: allSelectedUnread, onSelect: () => applyBulkRead(false) },
                  {
                    id: "delete",
                    label: selectedCount === 1 ? "Delete update" : "Delete selected",
                    icon: <Trash2 className="h-4 w-4" />,
                    destructive: true,
                    separatorBefore: true,
                    onSelect: () => deleteNotifications([...selectedIds])
                  },
                  { id: "clear", label: "Clear selection", separatorBefore: true, onSelect: () => setSelectedIds(new Set()) }
                ]}
              />
            ) : (
              <span className="text-sm text-muted-foreground">Select updates to manage.</span>
            )}
            <Button type="button" size="sm" variant="ghost" onClick={exitSelection}>
              Done
            </Button>
          </div>
        ) : (
          // Category chips (All / Nearby / Social / Plans / Safety), scrollable.
          <div
            data-tour-id={TOUR_TARGET_IDS.PULSE_FILTERS}
            className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0"
            role="tablist"
            aria-label="Pulse filters"
          >
            {PULSE_CATEGORIES.map((option) => {
              const active = category === option.value;
              const Icon = option.icon;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setCategory(option.value)}
                  className={cn(
                    "focus-ring safe-motion inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm font-medium",
                    active
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border/70 text-muted-foreground hover:bg-secondary/50 hover:text-foreground"
                  )}
                >
                  {Icon ? <Icon className="h-3.5 w-3.5" aria-hidden="true" /> : null}
                  {option.label}
                </button>
              );
            })}
          </div>
        )}

        <div data-tour-id={TOUR_TARGET_IDS.PULSE_LIST}>
          {visibleNotifications.length > 0 ? (
            <div className="space-y-5 pt-4">
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
                        onDelete={() => deleteNotifications([notification.id])}
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
              title={category === "all" ? "You’re all caught up" : `No ${categoryLabel(category)} activity yet`}
              description={
                category === "all"
                  ? "New updates will appear here."
                  : `${categoryEmptyHint(category)}`
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
  onDelete: () => void;
  onActivate: () => void;
};

function NotificationCard({
  notification,
  destination,
  selectionMode,
  selected,
  onToggleSelect,
  onDelete,
  onActivate
}: NotificationCardProps) {
  const actionable = Boolean(notification.meetupRequestId);
  const iconClass = categoryIconClass(categoryForType(notification.type));
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
      <div className={cn("mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full", iconClass)}>
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

  const wrapperClass = "flex items-stretch border-b border-border/60 last:border-b-0";
  const baseClass =
    "flex min-h-[80px] min-w-0 flex-1 items-start gap-3 rounded-xl px-2 py-3";
  const interactiveClass =
    "focus-ring cursor-pointer text-left transition-colors hover:bg-secondary/50 active:bg-secondary/70";
  const deleteControl = !selectionMode ? (
    <button
      type="button"
      onClick={onDelete}
      disabled={false}
      aria-label={`Delete: ${notification.title}`}
      title="Delete update"
      className="focus-ring my-auto mr-1 grid h-11 w-11 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
    >
      <Trash2 className="h-4 w-4" aria-hidden="true" />
    </button>
  ) : null;

  // Selection mode wins: the whole row toggles selection (checkbox semantics),
  // and no navigation happens until selection mode is closed.
  if (selectionMode) {
    return (
      <div className={wrapperClass}>
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
      </div>
    );
  }

  if (isLink && destination) {
    return (
      <div className={wrapperClass}>
        <Link
          href={destination.href}
          onClick={onActivate}
          aria-label={`Open: ${notification.title}`}
          className={cn(baseClass, interactiveClass)}
        >
          {body}
        </Link>
        {deleteControl}
      </div>
    );
  }

  if (actionable) {
    return (
      <div className={wrapperClass}>
        <button
          type="button"
          onClick={onActivate}
          aria-label={`Reply to ${notification.title}`}
          className={cn(baseClass, interactiveClass, "w-full")}
        >
          {body}
        </button>
        {deleteControl}
      </div>
    );
  }

  return (
    <div className={wrapperClass}>
      <article className={cn(baseClass, !clickable && "cursor-default")}>{body}</article>
      {deleteControl}
    </div>
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
    system_alert: ShieldAlert,
    staff_message: Megaphone
  };

  return iconsByType[type.split(":")[0]] ?? Bell;
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
