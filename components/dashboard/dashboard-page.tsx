"use client";

import Link from "next/link";
import type { Route } from "next";
import {
  AlertTriangle,
  Bell,
  CalendarCheck2,
  CheckCheck,
  CheckCircle2,
  CircleDollarSign,
  Compass,
  Eye,
  EyeOff,
  Ghost,
  Hand,
  MapPinOff,
  MessageCircle,
  MessageSquareText,
  Moon,
  PartyPopper,
  Plus,
  RefreshCcw,
  ShieldCheck,
  Sparkles,
  UserPlus,
  Users,
  Users2,
  X
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { createMeetupRequestAction } from "@/app/(app)/premium-actions";
import { getVisibleHangoutsAction, requestHangoutAction, type VisibleHangout } from "@/app/(app)/hangout-actions";
import { updateVisibilityStatusAction } from "@/app/(app)/settings-actions";
import { HANGOUT_ACTIVITY_LABELS } from "@/lib/social/plans";
import { GlowAvatar } from "@/components/glow/glow-avatar";
import { MuddyProfileModal } from "@/components/glow/muddy-profile-modal";
import { PendingInvitePrompt } from "@/components/discovery/pending-invite-prompt";
import { ProfileCompletionReminder } from "@/components/profile/profile-completion-reminder";
import { JourneyStatusCard } from "@/components/safety/journey-status-card";
import { StatusComposer } from "@/components/social/status-composer";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { FeatureIcon } from "@/components/ui/feature-icon";
import { UserAvatar } from "@/components/ui/user-avatar";
import type { FeatureIconKey } from "@/lib/icons/feature-icons";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { resolveNotificationDestination } from "@/lib/notifications/destination";
import { formatMuddyStatusLabel } from "@/lib/social/rules";
import type { HomeUpcomingPlan, PlanAttendee } from "@/lib/social/upcoming-plans";
import { type FreshnessState } from "@/lib/proximity/freshness";
import { proximityLabels, type ConfidenceLevel, type ProximityLevel } from "@/lib/proximity";
import type { ActivityType, AvailabilityType, SubscriptionPlan } from "@/lib/supabase/database.types";
import type { SafeArrivalStatus } from "@/lib/supabase/database.types";
import { cn, formatRelativeTime } from "@/lib/utils";

type DashboardFriend = {
  friendId: string;
  displayName: string;
  username: string;
  avatarUrl: string | null;
  proximityLevel: ProximityLevel;
  glowStrength: number;
  statusText: string;
  lastActiveEstimate: string;
  isPremiumThemeUnlocked: boolean;
  confidence: ConfidenceLevel;
  muddyStatusLabel: string | null;
  availability: string | null;
  freshnessState: FreshnessState;
};

type NearbyFriendApiItem = {
  friend_id: string;
  display_name: string;
  username: string;
  avatar_url: string | null;
  proximity_level: ProximityLevel;
  glow_strength: number;
  status_text: string;
  last_active_estimate: string;
  freshness_state: FreshnessState;
  is_premium_theme_unlocked: boolean;
  confidence: ConfidenceLevel;
  muddy_availability: string | null;
  muddy_activity: string | null;
  muddy_status_note: string | null;
};

type AttentionItem = {
  id: string;
  type: string;
  href: string;
  title: string;
  preview: string;
  time: string;
  icon: LucideIcon;
};

type ApiNotification = {
  id: string;
  type: string;
  title: string;
  message: string;
  is_read: boolean;
  created_at: string;
};

type DashboardPageContentProps = {
  subscriptionPlan?: SubscriptionPlan;
  hasPremium?: boolean;
  initialVisibilityStatus?: "visible" | "ghost" | "app_open_only";
  displayName?: string;
  hasActiveStatus?: boolean;
  initialStatusAvailability?: AvailabilityType;
  initialStatusActivity?: ActivityType | null;
  initialStatusNote?: string;
  upcomingPlans?: HomeUpcomingPlan[];
  hasMorePlans?: boolean;
  glowColorByFriendId?: Record<string, string>;
  profileReminder?: {
    userId: string;
    missingItems: string[];
  } | null;
  safeArrivalSession?: {
    id: string;
    expectedArrivalAt: string;
    gracePeriodMinutes: number;
    status: string;
    travellerName: string;
    isTraveller: boolean;
    startedAt: string;
    watchers: Array<{ id: string; name: string; avatarUrl: string | null }>;
    sharedCount: number;
  } | null;
};

const attentionIconByType: Record<string, LucideIcon> = {
  friend_request_received: UserPlus,
  friend_request_accepted: CheckCheck,
  friend_nearby: MapPinOff,
  meetup_request: MessageCircle,
  wave: Hand
};

function capitalize(name: string) {
  return name ? name.charAt(0).toUpperCase() + name.slice(1) : name;
}

export function DashboardPageContent({
  subscriptionPlan = "free",
  hasPremium = false,
  initialVisibilityStatus = "visible",
  displayName = "",
  hasActiveStatus = false,
  initialStatusAvailability,
  initialStatusActivity = null,
  initialStatusNote = "",
  upcomingPlans = [],
  hasMorePlans = false,
  glowColorByFriendId = {},
  profileReminder = null,
  safeArrivalSession = null
}: DashboardPageContentProps) {
  const reducedMotion = useReducedMotion();
  const [ghostMode, setGhostMode] = useState(initialVisibilityStatus === "ghost");
  const [friends, setFriends] = useState<DashboardFriend[]>([]);
  const [statusMessage, setStatusMessage] = useState("");
  const [isCheckingNearby, setIsCheckingNearby] = useState(false);
  const [promptFeedback, setPromptFeedback] = useState<{ title?: string; message: string; error: boolean } | null>(
    null
  );
  const [selectedFriendId, setSelectedFriendId] = useState<string | null>(null);
  const [attentionItems, setAttentionItems] = useState<AttentionItem[]>([]);
  const [unreadActivityCount, setUnreadActivityCount] = useState(0);
  const [openHangouts, setOpenHangouts] = useState<VisibleHangout[]>([]);
  const [isPending, startTransition] = useTransition();
  const locationUpdateInFlightRef = useRef(false);
  const promptFeedbackTimerRef = useRef<number | null>(null);
  const visibleFriends = !ghostMode ? friends : [];
  // The nearby endpoint also returns friends whose signal is stale ("hidden")
  // or who are merely within the broader "far" bucket, real data the API
  // legitimately reports, but not what belongs in a "Nearby friends" glance.
  // Only these three levels count toward the proximity pills above, so the
  // card grid must match that same set or the two disagree (the exact bug
  // this filter fixes: "1 nearby" while two cards render).
  const nearbyFriends = visibleFriends.filter(
    (friend) =>
      friend.proximityLevel === "very_close" || friend.proximityLevel === "nearby" || friend.proximityLevel === "around"
  );
  // "Muddies open to plans" reuses the existing availability signal only, a
  // Muddy who set their availability to "open to hang out". No invented state.
  const openToPlansMuddies = visibleFriends.filter((friend) => friend.availability === "open_to_hang_out");
  const selectedFriend = visibleFriends.find((friend) => friend.friendId === selectedFriendId) ?? null;

  // Home shows only a compact preview of nearby Muddies; the cap adapts to the
  // viewport (mobile 5, tablet 6, desktop 8) and "View all" links to the full
  // Muddies list when more active Muddies exist than the preview shows. The
  // list only renders after a client fetch, so a width-derived cap is free of
  // hydration concerns.
  const [previewLimit, setPreviewLimit] = useState(8);
  const nearbyPreview = nearbyFriends.slice(0, previewLimit);
  const hasMoreNearbyFriends = nearbyFriends.length > previewLimit;

  const proximityCounts = useMemo(() => {
    const counts = { very_close: 0, nearby: 0, around: 0 };
    if (ghostMode) return counts;
    friends.forEach((friend) => {
      if (friend.proximityLevel === "very_close") counts.very_close += 1;
      else if (friend.proximityLevel === "nearby") counts.nearby += 1;
      else if (friend.proximityLevel === "around") counts.around += 1;
    });
    return counts;
  }, [friends, ghostMode]);

  const scheduleToastDismiss = useCallback(() => {
    if (promptFeedbackTimerRef.current) window.clearTimeout(promptFeedbackTimerRef.current);
    promptFeedbackTimerRef.current = window.setTimeout(() => setPromptFeedback(null), 3500);
  }, []);

  const showPromptFeedback = useCallback(
    (message: string, error = false, title?: string) => {
      setPromptFeedback({ title, message, error });
      scheduleToastDismiss();
    },
    [scheduleToastDismiss]
  );

  const pauseToastDismiss = useCallback(() => {
    if (promptFeedbackTimerRef.current) window.clearTimeout(promptFeedbackTimerRef.current);
  }, []);

  const dismissToast = useCallback(() => {
    if (promptFeedbackTimerRef.current) window.clearTimeout(promptFeedbackTimerRef.current);
    setPromptFeedback(null);
  }, []);

  const loadNearbyFriends = useCallback(() => {
    startTransition(async () => {
      try {
        const response = await fetch("/api/friends/nearby", {
          method: "GET",
          credentials: "include"
        });

        if (!response.ok) {
          const error = (await response.json().catch(() => ({ error: "Could not refresh nearby friends." }))) as {
            error?: string;
          };
          setFriends([]);
          setStatusMessage(error.error ?? "Could not refresh nearby friends.");
          return;
        }

        const data = (await response.json()) as { friends: NearbyFriendApiItem[] };
        setFriends(data.friends.map(toDashboardFriend));
        setStatusMessage("");
      } catch {
        setFriends([]);
        setStatusMessage("Could not reach the nearby friends service.");
      }
    });
  }, []);

  const updatePrivateLocation = useCallback(() => {
    if (locationUpdateInFlightRef.current) return;

    if (!("geolocation" in navigator)) {
      setStatusMessage("This browser does not support location permission.");
      return;
    }

    locationUpdateInFlightRef.current = true;
    // Transient loading state, not a permanent description; cleared in every
    // terminal branch below so it never sticks.
    setIsCheckingNearby(true);
    setStatusMessage("");
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        try {
          const response = await fetch("/api/location/update", {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              latitude: position.coords.latitude,
              longitude: position.coords.longitude,
              accuracy: position.coords.accuracy
            })
          });

          if (!response.ok) {
            const data = (await response.json().catch(() => null)) as { error?: string } | null;
            setStatusMessage(data?.error ?? "Could not update your private proximity signal.");
            locationUpdateInFlightRef.current = false;
            setIsCheckingNearby(false);
            return;
          }

          locationUpdateInFlightRef.current = false;
          setIsCheckingNearby(false);
          loadNearbyFriends();
        } catch {
          locationUpdateInFlightRef.current = false;
          setIsCheckingNearby(false);
          setStatusMessage("Could not update your private proximity signal.");
        }
      },
      (error) => {
        locationUpdateInFlightRef.current = false;
        setIsCheckingNearby(false);
        if (error.code === error.PERMISSION_DENIED) {
          setStatusMessage("Location access is blocked. Allow it in this browser’s site settings, then refresh.");
        } else if (error.code === error.POSITION_UNAVAILABLE) {
          setStatusMessage("This browser could not determine your location. Check device location services and try again.");
        } else {
          setStatusMessage("The location check timed out. Try again.");
        }
      },
      { enableHighAccuracy: true, maximumAge: 30_000, timeout: 15_000 }
    );
  }, [loadNearbyFriends]);

  useEffect(() => {
    loadNearbyFriends();
  }, [loadNearbyFriends]);

  useEffect(() => {
    const computeLimit = () => {
      const width = window.innerWidth;
      setPreviewLimit(width < 768 ? 5 : width < 1024 ? 6 : 8);
    };
    computeLimit();
    window.addEventListener("resize", computeLimit);
    return () => window.removeEventListener("resize", computeLimit);
  }, []);

  useEffect(() => {
    let isMounted = true;

    async function loadAttentionItems() {
      try {
        const response = await fetch("/api/notifications", { credentials: "include", cache: "no-store" });
        if (!response.ok || !isMounted) return;
        const data = (await response.json()) as { notifications: ApiNotification[] };
        const unread = data.notifications.filter((notification) => !notification.is_read);
        setUnreadActivityCount(unread.length);
        setAttentionItems(
          unread.slice(0, 3).map((notification) => ({
            id: notification.id,
            type: notification.type,
            // Deep link via the shared resolver; fall back to the Pulse hub for
            // informational notifications with no specific destination.
            href: resolveNotificationDestination(notification.type)?.href ?? "/notifications",
            title: notification.title,
            preview: notification.message,
            time: formatRelativeTime(notification.created_at),
            icon: attentionIconByType[notification.type.split(":")[0]] ?? Bell
          }))
        );
      } catch {
        // Leave attention items empty if the request fails.
      }
    }

    void loadAttentionItems();
    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    return () => {
      if (promptFeedbackTimerRef.current) {
        window.clearTimeout(promptFeedbackTimerRef.current);
      }
    };
  }, []);

  // Hangouts the viewer is eligible to see (audience-gated server-side, incl.
  // Close Friends / circles) so a Muddy's active hangout shows up in "open to
  // plans" — not only inside Hangout Mode.
  useEffect(() => {
    let mounted = true;
    getVisibleHangoutsAction()
      .then((list) => {
        if (mounted) setOpenHangouts(list);
      })
      .catch(() => {
        // Leave hangouts empty if the request fails.
      });
    return () => {
      mounted = false;
    };
  }, []);

  function requestHangout(hangoutId: string) {
    setOpenHangouts((current) =>
      current.map((item) => (item.id === hangoutId ? { ...item, myRequestStatus: "pending" } : item))
    );
    startTransition(async () => {
      const result = await requestHangoutAction(hangoutId);
      if (!result.ok) {
        setOpenHangouts((current) =>
          current.map((item) => (item.id === hangoutId ? { ...item, myRequestStatus: null } : item))
        );
        showPromptFeedback(result.message, true);
      }
    });
  }

  useEffect(() => {
    const handleLocationUpdated = () => loadNearbyFriends();
    const handleLocationError = (event: Event) => {
      const detail = (event as CustomEvent<{ message?: string }>).detail;
      if (detail?.message) setStatusMessage(detail.message);
    };
    window.addEventListener("mad-buddy:location-updated", handleLocationUpdated);
    window.addEventListener("mad-buddy:location-sync-error", handleLocationError);
    return () => {
      window.removeEventListener("mad-buddy:location-updated", handleLocationUpdated);
      window.removeEventListener("mad-buddy:location-sync-error", handleLocationError);
    };
  }, [loadNearbyFriends]);

  function toggleVisibility() {
    const nextGhostMode = !ghostMode;

    startTransition(async () => {
      const result = await updateVisibilityStatusAction(nextGhostMode ? "ghost" : "visible");
      setStatusMessage(result.ok ? "" : result.message);

      if (result.ok) {
        setGhostMode(nextGhostMode);
        window.dispatchEvent(
          new CustomEvent("mad-buddy:location-sync-status", {
            detail: { enabled: !nextGhostMode }
          })
        );
        if (!nextGhostMode) updatePrivateLocation();
      }
    });
  }

  function sendConnectionPrompt(friendId: string, message: string) {
    showPromptFeedback("Sending...");
    startTransition(async () => {
      try {
        const result = await createMeetupRequestAction({
          receiverId: friendId,
          message
        });
        showPromptFeedback(result.message, !result.ok);
      } catch {
        showPromptFeedback("Couldn’t send your message. Try again.", true);
      }
    });
  }

  return (
    // The app shell supplies 16px mobile, 24px tablet, and 32px desktop
    // horizontal padding. This single wrapper caps and centres Home without
    // adding a second padded full-width layer.
    <div className="mx-auto w-full max-w-[1200px] space-y-6 pt-6">
      <SubscriptionStatusPortal plan={subscriptionPlan} hasPremium={hasPremium} />

      {/* If this account arrived from an invite while logged out, offer to
          connect them with the inviter now that they're signed in. */}
      <PendingInvitePrompt />

      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl" suppressHydrationWarning>
          {getGreeting()}
          {displayName ? `, ${capitalize(displayName)}` : ""}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">See which approved Muddies are nearby.</p>
        <div className="mt-3">
          <StatusComposer
            hasActiveStatus={hasActiveStatus}
            initialAvailability={initialStatusAvailability}
            initialActivity={initialStatusActivity}
            initialNote={initialStatusNote}
            onSaved={({ message, expiresAt }) => {
              if (expiresAt) {
                const time = new Date(expiresAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
                showPromptFeedback(`Visible to your Muddies until ${time}.`, false, "Status updated");
              } else {
                showPromptFeedback(message);
              }
            }}
            trigger={
              <button
                type="button"
                title={hasActiveStatus ? "Edit your status" : "Add a status"}
                className="focus-ring safe-motion inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-full border border-border/70 bg-card/50 px-3 text-sm font-medium text-foreground hover:bg-secondary/60"
              >
                <MessageSquareText className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                {hasActiveStatus ? "Edit status" : "Add status"}
              </button>
            }
          />
        </div>
      </div>

      {profileReminder ? (
        <ProfileCompletionReminder userId={profileReminder.userId} missingItems={profileReminder.missingItems} />
      ) : null}

      {(() => {
        const nearbyTotal = proximityCounts.very_close + proximityCounts.nearby + proximityCounts.around;
        const statusDot = (
          <span
            className={cn("h-2 w-2 shrink-0 rounded-full", ghostMode ? "bg-muted-foreground" : "bg-emerald-500")}
            aria-hidden="true"
          />
        );
        // Pause is the primary action (subtle bordered emphasis); refresh is a
        // neutral ghost icon so the two don't read as equal weight.
        const statusActions = (
          <div className="flex shrink-0 items-center gap-1">
            <Button
              type="button"
              variant={ghostMode ? "primary" : "outline"}
              size="icon"
              onClick={toggleVisibility}
              disabled={isPending}
              aria-label={ghostMode ? "Resume visibility" : "Pause visibility"}
              title={ghostMode ? "Resume visibility" : "Pause visibility"}
            >
              {ghostMode ? <Eye className="h-4 w-4" aria-hidden="true" /> : <EyeOff className="h-4 w-4" aria-hidden="true" />}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={updatePrivateLocation}
              disabled={isPending}
              aria-label="Check again"
              title="Check again"
            >
              <RefreshCcw
                className={cn("h-4 w-4", isCheckingNearby && "animate-spin motion-reduce:animate-none")}
                aria-hidden="true"
              />
            </Button>
          </div>
        );

        return (
          <div>
            {/* Mobile: the full card with the helper line, so the meaning is
                spelled out on the smallest screen. */}
            <section className="rounded-2xl bg-card/55 p-5 shadow-sm dark:bg-white/[0.035] md:hidden">
              <div className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2">
                  {statusDot}
                  <span className="text-sm font-semibold">{ghostMode ? "Visibility paused" : "Visible"}</span>
                </div>
                {statusActions}
              </div>

              {!ghostMode ? (
                <p className="mt-1.5 text-sm text-muted-foreground">{formatNearbyCount(nearbyTotal)}</p>
              ) : null}

              <p className="mt-1 text-xs text-muted-foreground" role="status">
                {isCheckingNearby
                  ? "Checking nearby Muddies…"
                  : statusMessage ||
                    (ghostMode
                      ? "You won’t appear nearby until you turn visibility back on."
                      : "Approved Muddies can see when you’re nearby.")}
              </p>
            </section>

            {/* Tablet + web: a compact single-row status bar — no card container,
                so the feed below sits higher. The pause/refresh buttons sit
                right next to the status text rather than pushed to the edge. */}
            <div className="hidden items-center gap-3 md:flex">
              <div className="flex min-w-0 items-center gap-2.5">
                {statusDot}
                <span className="shrink-0 text-sm font-semibold">{ghostMode ? "Visibility paused" : "Visible"}</span>
                <span className="truncate text-sm text-muted-foreground" role="status">
                  {isCheckingNearby
                    ? "Checking nearby Muddies…"
                    : statusMessage ||
                      (ghostMode ? "Turn visibility on to appear nearby" : formatNearbyCount(nearbyTotal))}
                </span>
              </div>
              {statusActions}
            </div>
          </div>
        );
      })()}

      {safeArrivalSession ? (
        <section className="min-w-0" aria-labelledby="home-safe-arrival-heading">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 id="home-safe-arrival-heading" className="text-lg font-semibold tracking-tight">
              Safe Arrival
            </h2>
            <Link href="/safe-arrival" className="text-sm font-medium text-primary hover:underline">
              View journey
            </Link>
          </div>
          <JourneyStatusCard
            role={safeArrivalSession.isTraveller ? "traveller" : "watcher"}
            sessionId={safeArrivalSession.id}
            status={safeArrivalSession.status as SafeArrivalStatus}
            travellerName={safeArrivalSession.travellerName}
            watchers={safeArrivalSession.watchers}
            sharedCount={safeArrivalSession.sharedCount}
            startedAtLabel={formatRelativeTime(safeArrivalSession.startedAt)}
          />
        </section>
      ) : null}

      {/* One dashboard grid. Explicit desktop positions retain the existing
          mobile feed order while forming independent 2:1 desktop columns. */}
      <div className="grid min-w-0 gap-y-8 lg:grid-cols-[minmax(0,2fr)_minmax(300px,1fr)] lg:gap-x-8">
        <section className="min-w-0 self-start lg:col-start-1 lg:row-start-1">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-semibold tracking-tight">Nearby Muddies</h2>
            {hasMoreNearbyFriends ? (
              <Link
                href="/friends"
                aria-label="View all Muddies"
                className="text-sm font-medium text-primary hover:underline"
              >
                View all
              </Link>
            ) : null}
          </div>

          {nearbyFriends.length > 0 ? (
            <>
              {/* Mobile: a horizontal avatar strip so several Muddies are
                  visible at a glance without pushing the feed below the fold.
                  Hidden scrollbar keeps touch scrolling. The larger leading
                  and top insets contain the animated halo at peak scale so
                  the scroll boundary never cuts it into a sharp line. */}
              <div
                className="glow-strip no-scrollbar -mx-4 flex gap-4 overflow-x-auto pb-3 pl-12 pr-7 pt-7 md:hidden"
                aria-label="Nearby Muddies"
              >
                {nearbyPreview.map((friend) => {
                  const name = friend.displayName || friend.username;
                  return (
                    <button
                      key={friend.friendId}
                      type="button"
                      onClick={() => setSelectedFriendId(friend.friendId)}
                      className="focus-ring safe-motion flex w-20 shrink-0 flex-col items-center gap-1.5 text-center"
                      aria-label={`${capitalize(name)}, ${proximityLabels[friend.proximityLevel]}`}
                    >
                      <GlowAvatar
                        name={name}
                        src={friend.avatarUrl}
                        proximityLevel={friend.proximityLevel}
                        glowStrength={friend.glowStrength}
                        confidence={friend.confidence}
                        glowColorId={glowColorByFriendId[friend.friendId] ?? null}
                        size="md"
                        reducedMotion={reducedMotion}
                      />
                      <span className="w-full truncate text-xs font-medium">{capitalize(name)}</span>
                      <span className="inline-flex items-center rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                        {proximityLabels[friend.proximityLevel]}
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* Desktop/tablet: standalone glowing avatars (no card, no
                  border), the same visual language as the mobile strip but
                  wrapping. Padding keeps the contained glow from being clipped. */}
              <div className="hidden flex-wrap gap-x-6 gap-y-5 pb-1 pl-6 pt-3 md:flex" aria-label="Nearby Muddies">
                {nearbyPreview.map((friend) => {
                  const name = friend.displayName || friend.username;
                  return (
                    <button
                      key={friend.friendId}
                      type="button"
                      onClick={() => setSelectedFriendId(friend.friendId)}
                      className="focus-ring safe-motion flex min-w-0 shrink-0 flex-col items-center text-center"
                      aria-label={`${capitalize(name)}, ${proximityLabels[friend.proximityLevel]}`}
                    >
                      <GlowAvatar
                        name={name}
                        src={friend.avatarUrl}
                        proximityLevel={friend.proximityLevel}
                        glowStrength={friend.glowStrength}
                        confidence={friend.confidence}
                        glowColorId={glowColorByFriendId[friend.friendId] ?? null}
                        size="lg"
                        reducedMotion={reducedMotion}
                      />
                      <span className="mt-2 max-w-24 truncate text-sm font-medium">{capitalize(name)}</span>
                      <span className="mt-1.5 inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                        {proximityLabels[friend.proximityLevel]}
                      </span>
                      {friend.muddyStatusLabel ? (
                        <span className="mt-1 w-full truncate text-xs text-muted-foreground">
                          {friend.muddyStatusLabel}
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </>
          ) : (
            <EmptyState
              icon={ghostMode ? Ghost : Users}
              className="w-full !border-border/50 !shadow-none p-4 sm:p-5"
              title={ghostMode ? "Visibility is paused" : "No Muddies nearby"}
              description={
                ghostMode
                  ? "You won’t appear nearby until you turn visibility back on."
                  : "Approved Muddies will appear here when they’re nearby."
              }
              action={
                !ghostMode ? (
                  <Button type="button" asChild>
                    <Link href="/friends?tab=add">
                      <UserPlus className="h-4 w-4" aria-hidden="true" />
                      Add Muddies
                    </Link>
                  </Button>
                ) : undefined
              }
            />
          )}
        </section>

        <div className="min-w-0 self-start lg:col-start-2 lg:row-start-1">
          <QuickActions />
        </div>

        <div className="min-w-0 self-start lg:col-start-1 lg:row-start-2">
          <FeaturedPlan plan={upcomingPlans[0]} hasMore={hasMorePlans || upcomingPlans.length > 1} />
        </div>

        {attentionItems.length > 0 ? (
          <section className="min-w-0 self-start lg:col-start-2 lg:row-start-2">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-semibold tracking-tight">Recent activity</h2>
              {unreadActivityCount > attentionItems.length ? (
                <Link
                  href="/notifications"
                  aria-label="View all activity"
                  className="text-sm font-medium text-primary hover:underline"
                >
                  View all
                </Link>
              ) : null}
            </div>

            <ul className="divide-y divide-border/60 rounded-2xl border border-border/70 bg-card/40">
              {attentionItems.map((item) => (
                <li key={item.id}>
                  <Link
                    href={item.href as Route}
                    aria-label={`Open: ${capitalize(item.title)}`}
                    className="focus-ring safe-motion flex min-h-[60px] items-center gap-3 px-4 py-3 hover:bg-secondary/50"
                  >
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
                      <item.icon className="h-4 w-4" aria-hidden="true" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{capitalize(item.title)}</span>
                      {item.preview ? (
                        <span className="block truncate text-xs text-muted-foreground">{item.preview}</span>
                      ) : null}
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">{item.time}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        <div className="min-w-0 self-start lg:col-start-1 lg:row-start-3">
          <MuddiesOpenToPlans
            muddies={openToPlansMuddies}
            hangouts={openHangouts}
            glowColorByFriendId={glowColorByFriendId}
            onSelect={setSelectedFriendId}
            onRequestHangout={requestHangout}
            isPending={isPending}
          />
        </div>
      </div>

      {promptFeedback ? (
        <div
          role="status"
          aria-live="polite"
          onMouseEnter={pauseToastDismiss}
          onMouseLeave={scheduleToastDismiss}
          onFocus={pauseToastDismiss}
          onBlur={scheduleToastDismiss}
          // Sits above the mobile bottom nav (its 88px + safe-area) so it never
          // covers it; on desktop there is no bottom nav, so a small offset.
          // A fixed dark surface in every theme, per the toast spec, rather
          // than bg-card which would be near-white in the light theme.
          className="toast-in fixed bottom-[calc(88px+env(safe-area-inset-bottom))] left-1/2 z-50 w-[calc(100%-2rem)] max-w-[320px] -translate-x-1/2 md:bottom-6"
        >
          <div className="flex items-start gap-2.5 rounded-xl border border-white/10 bg-[#1b1b1d] px-4 py-3 text-white shadow-lg">
            <span className={cn("mt-0.5 shrink-0", promptFeedback.error ? "text-red-400" : "text-emerald-400")}>
              {promptFeedback.error ? (
                <AlertTriangle className="h-4 w-4" aria-hidden="true" />
              ) : (
                <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
              )}
            </span>
            <div className="min-w-0 flex-1">
              {promptFeedback.title ? (
                <p className="text-sm font-semibold leading-5">{promptFeedback.title}</p>
              ) : null}
              <p className={cn("leading-5", promptFeedback.title ? "text-xs text-white/70" : "text-sm font-medium")}>
                {promptFeedback.message}
              </p>
            </div>
            <button
              type="button"
              onClick={dismissToast}
              aria-label="Dismiss notification"
              className="focus-ring -mr-1 -mt-0.5 shrink-0 rounded-md p-1 text-white/60 hover:text-white"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </div>
      ) : null}
      <MuddyProfileModal
        muddy={
          selectedFriend
            ? {
                friendId: selectedFriend.friendId,
                displayName: selectedFriend.displayName,
                username: selectedFriend.username,
                avatarUrl: selectedFriend.avatarUrl,
                statusText: selectedFriend.statusText,
                proximityLevel: selectedFriend.proximityLevel,
                glowStrength: selectedFriend.glowStrength,
                confidence: selectedFriend.confidence,
                glowColorId: glowColorByFriendId[selectedFriend.friendId] ?? null
              }
            : null
        }
        onOpenChange={(open) => {
          if (!open) setSelectedFriendId(null);
        }}
        onSendPing={(message) => {
          if (selectedFriendId) sendConnectionPrompt(selectedFriendId, message);
        }}
      />

    </div>
  );
}

function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function formatNearbyCount(total: number): string {
  if (total <= 0) return "No Muddies nearby";
  if (total === 1) return "1 Muddy nearby";
  return `${total} Muddies nearby`;
}

// Compact tiles with short labels only (the full description lives in the
// tooltip / aria-label and the opened flow, not permanently on Home). Each
// links to its existing route; nothing here duplicates that feature's logic.
const quickActions: Array<{
  href:
    | "/hangout-mode"
    | "/safe-arrival"
    | "/moments"
    | "/events"
    | "/groups"
    | "/discover"
    | "/invites"
    | "/reminders"
    | "/settings/engagement";
  label: string;
  description: string;
  icon: LucideIcon;
  featureIcon: FeatureIconKey;
}> = [
  {
    href: "/hangout-mode",
    label: "Hangout",
    description: "Let your Muddies know you’re open to meeting.",
    icon: Hand,
    featureIcon: "hangout"
  },
  {
    href: "/safe-arrival",
    label: "Safe Arrival",
    description: "Let trusted Muddies know when you arrive safely.",
    icon: ShieldCheck,
    featureIcon: "safeArrival"
  },
  {
    href: "/moments",
    label: "Moments",
    description: "Share a moment with your Muddies before it disappears.",
    icon: Sparkles,
    featureIcon: "moments"
  },
  {
    href: "/events",
    label: "Events",
    description: "View events and see what is coming up.",
    icon: PartyPopper,
    featureIcon: "events"
  },
  {
    href: "/groups",
    label: "Groups",
    description: "Open your groups and group invitations.",
    icon: Users2,
    featureIcon: "groups"
  },
  {
    href: "/discover",
    label: "Socialize",
    description: "Find people who are open to socializing.",
    icon: Compass,
    featureIcon: "socialize"
  },
  {
    href: "/invites",
    label: "Invites",
    description: "Review invitations and invite your Muddies.",
    icon: UserPlus,
    featureIcon: "invites"
  },
  {
    href: "/reminders",
    label: "Reminders",
    description: "Review reminders for plans and connections.",
    icon: Bell,
    featureIcon: "reminders"
  },
  {
    href: "/settings/engagement",
    label: "Focus",
    description: "Manage Focus Mode and notification limits.",
    icon: Moon,
    featureIcon: "focus"
  }
];

function QuickActions() {
  return (
    <section className="min-w-0" aria-label="Quick actions">
      <h2 className="mb-3 text-lg font-semibold tracking-tight">Quick actions</h2>
      <div className="grid min-w-0 grid-cols-3 gap-2">
        {quickActions.map((action) => (
          <Link
            key={action.href}
            href={action.href}
            aria-label={action.description}
            title={action.description}
            className="focus-ring safe-motion flex h-14 min-w-0 flex-col items-center justify-center gap-1 rounded-xl border border-border/70 bg-card/50 p-1.5 text-center hover:bg-secondary/40"
          >
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-primary/10 text-primary">
              <FeatureIcon feature={action.featureIcon} size={20} decorative />
            </span>
            <span className="truncate text-[11px] font-medium leading-tight">{action.label}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}

function rsvpLabel(rsvp: string): string {
  switch (rsvp) {
    case "going":
      return "Going";
    case "maybe":
      return "Maybe";
    case "not_going":
    case "declined":
      return "Not going";
    default:
      return "Invited";
  }
}

function PlanFace({ attendee }: { attendee: PlanAttendee }) {
  const name = attendee.name || "Muddy";
  return (
    <UserAvatar
      src={attendee.avatarUrl}
      name={capitalize(name)}
      size="xs"
      className="border-2 border-card bg-primary/15 text-primary"
    />
  );
}

function FeaturedPlan({ plan, hasMore }: { plan: HomeUpcomingPlan | undefined; hasMore: boolean }) {
  const actionLabel = !plan
    ? ""
    : plan.myRsvp === "invited"
      ? "Respond"
      : plan.organiserName === "You"
        ? "Manage plan"
        : "View plan";

  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold tracking-tight">Upcoming plans</h2>
        {plan && hasMore ? (
          <Link href="/plans" className="text-sm font-medium text-primary hover:underline">
            View all
          </Link>
        ) : null}
      </div>

      {plan ? (
        <div className="max-h-[190px] rounded-2xl border border-border/70 bg-card/50 p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-base font-semibold">{capitalize(plan.title)}</p>
              <p className="mt-1 text-sm text-muted-foreground" suppressHydrationWarning>
                {new Date(plan.startAt).toLocaleString([], {
                  weekday: "short",
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit"
                })}
              </p>
              {plan.placeText ? (
                <p className="mt-0.5 truncate text-xs font-medium text-foreground/80">
                  {capitalize(plan.placeText)}
                </p>
              ) : null}
            </div>
            <span className="inline-flex shrink-0 items-center rounded-full bg-secondary px-2.5 py-1 text-xs font-medium text-foreground">
              {rsvpLabel(plan.myRsvp)}
            </span>
          </div>
          <div className="mt-4 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              {plan.attendees.length > 0 ? (
                <div className="flex -space-x-2">
                  {plan.attendees.map((attendee, index) => (
                    <PlanFace key={index} attendee={attendee} />
                  ))}
                </div>
              ) : null}
              <p className="text-xs text-muted-foreground">
                {plan.goingCount} going
                {plan.maybeCount > 0 ? ` · ${plan.maybeCount} maybe` : ""}
              </p>
            </div>
            <Button type="button" size="sm" asChild>
              <Link href="/plans">{actionLabel}</Link>
            </Button>
          </div>
        </div>
      ) : (
        <EmptyState
          icon={CalendarCheck2}
          className="w-full !border-border/50 !shadow-none p-4 sm:p-5"
          title="Nothing planned yet"
          description="Create a plan when you’re ready to meet up."
          action={
            <Button type="button" asChild>
              <Link href="/plans">
                <CalendarCheck2 className="h-4 w-4" aria-hidden="true" />
                New plan
              </Link>
            </Button>
          }
        />
      )}
    </section>
  );
}

const NEARBY_LEVELS = new Set<ProximityLevel>(["very_close", "nearby", "around"]);

function MuddiesOpenToPlans({
  muddies,
  hangouts,
  glowColorByFriendId,
  onSelect,
  onRequestHangout,
  isPending
}: {
  muddies: DashboardFriend[];
  hangouts: VisibleHangout[];
  glowColorByFriendId: Record<string, string>;
  onSelect: (friendId: string) => void;
  onRequestHangout: (hangoutId: string) => void;
  isPending: boolean;
}) {
  const hasContent = muddies.length > 0 || hangouts.length > 0;
  return (
    <section>
      <h2 className="mb-3 text-lg font-semibold tracking-tight">Muddies open to plans</h2>

      {hangouts.length > 0 ? (
        <ul className="mb-3 divide-y divide-border/60 rounded-2xl border border-primary/25 bg-primary/[0.04]">
          {hangouts.map((hangout) => (
            <li key={hangout.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">
                  {capitalize(hangout.ownerName)} is open to{" "}
                  {(HANGOUT_ACTIVITY_LABELS[hangout.activityType] ?? "hang out").toLowerCase()}
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                  {hangout.message ? `“${hangout.message}” · ` : ""}
                  Until {new Date(hangout.endsAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                </span>
              </span>
              {hangout.myRequestStatus ? (
                <span className="shrink-0 text-xs font-medium capitalize text-muted-foreground">
                  {hangout.myRequestStatus === "pending" ? "Requested" : hangout.myRequestStatus}
                </span>
              ) : (
                <Button type="button" size="sm" className="shrink-0" disabled={isPending} onClick={() => onRequestHangout(hangout.id)}>
                  I&apos;m interested
                </Button>
              )}
            </li>
          ))}
        </ul>
      ) : null}

      {muddies.length > 0 ? (
        <ul className="divide-y divide-border/60 rounded-2xl border border-border/70 bg-card/40">
          {muddies.map((muddy) => {
            const name = muddy.displayName || muddy.username;
            return (
              <li key={muddy.friendId}>
                <button
                  type="button"
                  onClick={() => onSelect(muddy.friendId)}
                  className="focus-ring safe-motion flex min-h-[64px] w-full items-center gap-3 px-4 py-3 text-left hover:bg-secondary/50"
                >
                  <GlowAvatar
                    name={name}
                    src={muddy.avatarUrl}
                    proximityLevel={muddy.proximityLevel}
                    glowStrength={muddy.glowStrength}
                    confidence={muddy.confidence}
                    glowColorId={glowColorByFriendId[muddy.friendId] ?? null}
                    size="sm"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{capitalize(name)}</span>
                    {muddy.muddyStatusLabel ? (
                      <span className="block truncate text-xs text-muted-foreground">{muddy.muddyStatusLabel}</span>
                    ) : null}
                  </span>
                  {NEARBY_LEVELS.has(muddy.proximityLevel) ? (
                    <span className="inline-flex shrink-0 items-center rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                      {proximityLabels[muddy.proximityLevel]}
                    </span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}

      {!hasContent ? (
        // Compact inline state, not a large bordered panel: keeps Home short
        // when nobody is available and stays left-aligned on desktop.
        <div className="flex max-w-[820px] items-start justify-between gap-4 rounded-xl bg-card/40 px-5 py-5 sm:px-6">
          <div className="min-w-0">
            <p className="text-sm font-medium">No Muddies are available right now</p>
            <p className="mt-0.5 text-xs text-muted-foreground">Check again later or start a new plan.</p>
          </div>
          <Button type="button" variant="outline" size="icon" className="shrink-0" asChild>
            <Link href="/plans" aria-label="New plan" title="New plan">
              <Plus className="h-4 w-4" aria-hidden="true" />
            </Link>
          </Button>
        </div>
      ) : null}
    </section>
  );
}

function toDashboardFriend(friend: NearbyFriendApiItem): DashboardFriend {
  return {
    friendId: friend.friend_id,
    displayName: friend.display_name,
    username: friend.username,
    avatarUrl: friend.avatar_url,
    proximityLevel: friend.proximity_level,
    glowStrength: friend.glow_strength,
    statusText: friend.status_text,
    lastActiveEstimate: friend.last_active_estimate,
    isPremiumThemeUnlocked: friend.is_premium_theme_unlocked,
    confidence: friend.confidence,
    muddyStatusLabel: formatMuddyStatusLabel({
      availability: friend.muddy_availability,
      activity: friend.muddy_activity,
      note: friend.muddy_status_note
    }),
    availability: friend.muddy_availability,
    freshnessState: friend.freshness_state
  };
}

function SubscriptionStatusPortal({ plan, hasPremium }: { plan: SubscriptionPlan; hasPremium: boolean }) {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      setTarget(document.getElementById("sidebar-subscription-status"));
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);
  const label = hasPremium ? (plan === "buddy_pro" ? "Buddy Pro active" : "Buddy Plus active") : "Free plan";
  if (!target) return null;
  return createPortal(
    <Link
      href="/billing"
      aria-label="Billing"
      title="Billing"
      data-subscription-status={label}
      className="focus-ring grid h-11 w-11 place-items-center rounded-xl text-muted-foreground hover:bg-secondary hover:text-foreground dark:hover:bg-white/[0.05]"
    >
      <CircleDollarSign className="h-5 w-5" aria-hidden="true" />
    </Link>,
    target
  );
}
