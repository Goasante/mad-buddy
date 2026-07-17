"use client";

import Link from "next/link";
import {
  Bell,
  CheckCheck,
  CircleDollarSign,
  Ghost,
  Hand,
  MapPinOff,
  MessageCircle,
  RefreshCcw,
  Sparkles,
  UserPlus,
  WifiOff
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { createMeetupRequestAction } from "@/app/(app)/premium-actions";
import { updateVisibilityStatusAction } from "@/app/(app)/settings-actions";
import { GlowAvatar } from "@/components/glow/glow-avatar";
import { MuddyProfileModal } from "@/components/glow/muddy-profile-modal";
import { StatusComposer } from "@/components/social/status-composer";
import { PulseSummary } from "@/components/dashboard/pulse-summary";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { formatMuddyStatusLabel } from "@/lib/social/rules";
import { freshnessLabel, type FreshnessState } from "@/lib/proximity/freshness";
import { proximityLabels, type ConfidenceLevel, type ProximityLevel } from "@/lib/proximity";
import type { SubscriptionPlan } from "@/lib/supabase/database.types";
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
  title: string;
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
};

const attentionIconByType: Record<string, LucideIcon> = {
  friend_request_received: UserPlus,
  friend_request_accepted: CheckCheck,
  friend_nearby: MapPinOff,
  meetup_request: MessageCircle,
  wave: Hand
};

export function DashboardPageContent({
  subscriptionPlan = "free",
  hasPremium = false,
  initialVisibilityStatus = "visible",
  displayName = "there"
}: DashboardPageContentProps) {
  const reducedMotion = useReducedMotion();
  const [ghostMode, setGhostMode] = useState(initialVisibilityStatus === "ghost");
  const [friends, setFriends] = useState<DashboardFriend[]>([]);
  const [statusMessage, setStatusMessage] = useState("Checking for nearby friends...");
  const [promptFeedback, setPromptFeedback] = useState<{ message: string; error: boolean } | null>(null);
  const [selectedFriendId, setSelectedFriendId] = useState<string | null>(null);
  const [statusComposerOpen, setStatusComposerOpen] = useState(false);
  const [attentionItems, setAttentionItems] = useState<AttentionItem[]>([]);
  const [isPending, startTransition] = useTransition();
  const locationUpdateInFlightRef = useRef(false);
  const promptFeedbackTimerRef = useRef<number | null>(null);
  const visibleFriends = !ghostMode ? friends : [];
  const selectedFriend = visibleFriends.find((friend) => friend.friendId === selectedFriendId) ?? null;

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

  const showPromptFeedback = useCallback((message: string, error = false) => {
    if (promptFeedbackTimerRef.current) {
      window.clearTimeout(promptFeedbackTimerRef.current);
    }
    setPromptFeedback({ message, error });
    promptFeedbackTimerRef.current = window.setTimeout(() => setPromptFeedback(null), 3200);
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
        setStatusMessage(data.friends.length > 0 ? "Nearby friends updated." : "");
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
    setStatusMessage("Updating your private proximity signal...");
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
            return;
          }

          locationUpdateInFlightRef.current = false;
          loadNearbyFriends();
        } catch {
          locationUpdateInFlightRef.current = false;
          setStatusMessage("Could not update your private proximity signal.");
        }
      },
      (error) => {
        locationUpdateInFlightRef.current = false;
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
    let isMounted = true;

    async function loadAttentionItems() {
      try {
        const response = await fetch("/api/notifications", { credentials: "include", cache: "no-store" });
        if (!response.ok || !isMounted) return;
        const data = (await response.json()) as { notifications: ApiNotification[] };
        setAttentionItems(
          data.notifications
            .filter((notification) => !notification.is_read)
            .slice(0, 4)
            .map((notification) => ({
              id: notification.id,
              title: notification.title,
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
      setStatusMessage(result.message);

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
    <div className="mb-dashboard mx-auto max-w-[1180px] pb-6 pt-5">
      <SubscriptionStatusPortal plan={subscriptionPlan} hasPremium={hasPremium} />

      <div className="mb-dashboard-heading flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl" suppressHydrationWarning>
            {getGreeting()}, {displayName} 👋
          </h1>
          <p className="mt-1 text-xs text-muted-foreground sm:text-sm">Here&apos;s what&apos;s happening around your people.</p>
        </div>
        <Button className="mb-set-status" type="button" variant="outline" size="sm" onClick={() => setStatusComposerOpen(true)}>
          <Sparkles className="h-4 w-4" aria-hidden="true" />
          Set status
        </Button>
      </div>

      <section className="mb-glow-card">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <span
              className={cn(
                "mb-glow-status inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.08em]",
                ghostMode
                  ? "text-muted-foreground"
                  : "text-emerald-400"
              )}
            >
              <span className={cn("h-1.5 w-1.5 rounded-full", ghostMode ? "bg-muted-foreground" : "bg-emerald-400")} />
              {ghostMode ? "Glow paused" : "Glow active"}
            </span>
            <span className="ml-3 text-[11px] text-muted-foreground">Approved Muddies&nbsp;&nbsp;•&nbsp;&nbsp;Updated {isPending ? "now" : "just now"}</span>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              className="h-8 rounded-lg px-3 text-xs"
              type="button"
              variant={ghostMode ? "primary" : "outline"}
              onClick={toggleVisibility}
              disabled={isPending}
              aria-label={ghostMode ? "Resume visibility" : "Pause visibility"}
            >
              {ghostMode ? "Resume Glow" : "Pause Glow"}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="h-8 w-8 rounded-lg p-0"
              onClick={updatePrivateLocation}
              disabled={isPending}
              aria-label="Check again"
              title="Check again"
            >
              <RefreshCcw className={cn("h-4 w-4", isPending && "animate-spin motion-reduce:animate-none")} aria-hidden="true" />
            </Button>
          </div>
        </div>

        {!ghostMode ? (
          <div className="mb-proximity-grid">
            <CountPill index="1" label="Very Close" count={proximityCounts.very_close} tone="strong" />
            <CountPill index="2" label="Nearby" count={proximityCounts.nearby} tone="medium" />
            <CountPill index="3" label="Around You" count={proximityCounts.around} tone="soft" />
          </div>
        ) : null}

        {isPending || statusMessage ? (
          <p className="mt-3 text-xs text-muted-foreground" role="status">
            {isPending ? "Checking for nearby friends..." : statusMessage}
          </p>
        ) : null}
        {ghostMode ? (
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            You won&apos;t appear nearby until you turn visibility back on.
          </p>
        ) : null}
      </section>

      <div className="mb-dashboard-columns">
      <div className="min-w-0">
      <section className="mb-nearby-section">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold tracking-tight sm:text-base">Nearby Muddies</h2>
          <Link href="/friends" className="text-xs font-medium text-muted-foreground hover:text-primary">
            See all →
          </Link>
        </div>

        {visibleFriends.length > 0 ? (
          <div className="mb-muddy-list" aria-label="Nearby Muddies">
            {visibleFriends.map((friend) => (
              <button
                key={friend.friendId}
                type="button"
                onClick={() => setSelectedFriendId(friend.friendId)}
                className="mb-muddy-card focus-ring safe-motion"
              >
                <GlowAvatar
                  name={friend.displayName}
                  src={friend.avatarUrl}
                  proximityLevel={friend.proximityLevel}
                  glowStrength={friend.glowStrength}
                  confidence={friend.confidence}
                  size="md"
                  reducedMotion={reducedMotion}
                />
                <span className="w-full truncate text-center text-xs font-medium">
                  {friend.displayName.split(" ")[0]}
                </span>
                <span className="w-full truncate text-center text-[9px] text-orange-400">
                  {friend.muddyStatusLabel ?? proximityLabels[friend.proximityLevel]}
                </span>
                <span className="w-full truncate text-center text-[10px] text-muted-foreground">{friend.statusText || "Free now"}</span>
                <span
                  className={cn(
                    "w-full truncate text-center text-[9px]",
                    friend.freshnessState === "stale" ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground/70"
                  )}
                >
                  {freshnessLabel(friend.freshnessState)}
                </span>
              </button>
            ))}
          </div>
        ) : (
          <EmptyState
            icon={ghostMode ? Ghost : WifiOff}
            className="w-full !border-border/50 !shadow-none p-4 sm:p-5"
            title={ghostMode ? "Visibility is paused" : "No Muddies nearby"}
            description={
              ghostMode
                ? "You won’t appear nearby until you turn visibility back on."
                : "Friends will appear here when they're nearby."
            }
            action={
              <Button type="button" asChild>
                <Link href="/friends">
                  <UserPlus className="h-4 w-4" aria-hidden="true" />
                  Add Muddies
                </Link>
              </Button>
            }
          />
        )}
      </section>
      </div>

      <aside className="mb-attention-column">
      <PulseSummary />
      <section className="mb-attention-section">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold tracking-tight">Needs your attention</h2>
          {attentionItems.length > 0 ? (
            <Link href="/notifications" className="text-sm font-medium text-primary hover:underline">
              See all
            </Link>
          ) : null}
        </div>

        {attentionItems.length > 0 ? (
          <ul className="mb-attention-list">
            {attentionItems.map((item) => (
              <li key={item.id}>
                <Link
                  href="/notifications"
                  className="focus-ring safe-motion flex items-center gap-3 px-3 py-2.5"
                >
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
                    <item.icon className="h-4 w-4" aria-hidden="true" />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm">{item.title}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{item.time}</span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-2xl border border-border/70 bg-card/40 px-4 py-3 text-sm text-muted-foreground">
            You&apos;re all caught up.
          </p>
        )}
      </section>
      </aside>
      </div>

      {promptFeedback ? (
        <div
          role="status"
          className={cn(
            "fixed bottom-24 left-1/2 z-50 -translate-x-1/2 rounded-full border px-4 py-2 text-sm font-medium shadow-lg md:bottom-6",
            promptFeedback.error
              ? "border-red-300/30 bg-red-950 text-red-50"
              : "border-border bg-foreground text-background"
          )}
        >
          {promptFeedback.message}
        </div>
      ) : null}
      <MuddyProfileModal
        muddy={
          selectedFriend
            ? {
                friendId: selectedFriend.friendId,
                displayName: selectedFriend.displayName,
                username: selectedFriend.username,
                about: selectedFriend.statusText,
                proximityLevel: selectedFriend.proximityLevel,
                glowStrength: selectedFriend.glowStrength,
                confidence: selectedFriend.confidence
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

      <StatusComposer
        open={statusComposerOpen}
        onOpenChange={setStatusComposerOpen}
        onSaved={(message) => showPromptFeedback(message)}
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

function CountPill({ index, label, count, tone }: { index: string; label: string; count: number; tone: "strong" | "medium" | "soft" }) {
  return (
    <span
      className={cn(
        "mb-proximity-item",
        tone === "strong" && "mb-proximity-strong",
        tone === "medium" && "mb-proximity-medium",
        tone === "soft" && "mb-proximity-soft"
      )}
    >
      <b>{count || index}</b><span>{label}</span>
    </span>
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
