"use client";

import Link from "next/link";
import {
  Bell,
  CalendarCheck2,
  CheckCheck,
  CircleDollarSign,
  Ghost,
  Hand,
  MapPinOff,
  MessageCircle,
  RefreshCcw,
  ShieldCheck,
  Sparkles,
  UserPlus,
  Users
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { createMeetupRequestAction } from "@/app/(app)/premium-actions";
import { updateVisibilityStatusAction } from "@/app/(app)/settings-actions";
import { GlowAvatar } from "@/components/glow/glow-avatar";
import { MuddyProfileModal } from "@/components/glow/muddy-profile-modal";
import { StatusComposer } from "@/components/social/status-composer";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { formatMuddyStatusLabel } from "@/lib/social/rules";
import { type FreshnessState } from "@/lib/proximity/freshness";
import { proximityLabels, type ConfidenceLevel, type ProximityLevel } from "@/lib/proximity";
import type { ActivityType, AvailabilityType, SubscriptionPlan } from "@/lib/supabase/database.types";
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
  hasActiveStatus?: boolean;
  initialStatusAvailability?: AvailabilityType;
  initialStatusActivity?: ActivityType | null;
  initialStatusNote?: string;
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
  initialStatusNote = ""
}: DashboardPageContentProps) {
  const reducedMotion = useReducedMotion();
  const [ghostMode, setGhostMode] = useState(initialVisibilityStatus === "ghost");
  const [friends, setFriends] = useState<DashboardFriend[]>([]);
  const [statusMessage, setStatusMessage] = useState("");
  const [promptFeedback, setPromptFeedback] = useState<{ message: string; error: boolean } | null>(null);
  const [selectedFriendId, setSelectedFriendId] = useState<string | null>(null);
  const [statusComposerOpen, setStatusComposerOpen] = useState(false);
  const [attentionItems, setAttentionItems] = useState<AttentionItem[]>([]);
  const [unreadActivityCount, setUnreadActivityCount] = useState(0);
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
  const selectedFriend = nearbyFriends.find((friend) => friend.friendId === selectedFriendId) ?? null;

  // The dashboard never truncates this list (every nearby friend is always
  // rendered), so "View all" would only ever be a redundant link to the same
  // set. Kept as an explicit flag rather than deleted outright so it's ready
  // to flip on if the list ever gains a display cap.
  const hasMoreNearbyFriends = false;

  // A friend's own full_name can be missing (deleted profile, sync gap); the
  // username is the one thing every account always has. Duplicate display
  // names (two friends both "Sam") get their @username shown for
  // disambiguation, this Set is what decides that per render.
  const duplicateDisplayNames = useMemo(() => {
    const seen = new Map<string, number>();
    for (const friend of nearbyFriends) {
      const name = (friend.displayName || friend.username).toLowerCase();
      seen.set(name, (seen.get(name) ?? 0) + 1);
    }
    return new Set([...seen.entries()].filter(([, count]) => count > 1).map(([name]) => name));
  }, [nearbyFriends]);

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
        const unread = data.notifications.filter((notification) => !notification.is_read);
        setUnreadActivityCount(unread.length);
        setAttentionItems(
          unread.slice(0, 4).map((notification) => ({
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
    <div className="mx-auto max-w-[1200px] space-y-7 pt-6">
      <SubscriptionStatusPortal plan={subscriptionPlan} hasPremium={hasPremium} />

      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl" suppressHydrationWarning>
            {getGreeting()}
            {displayName ? `, ${capitalize(displayName)}` : ""}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">See which approved Muddies are nearby.</p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setStatusComposerOpen(true)}
          title={hasActiveStatus ? "Update your status" : undefined}
        >
          <Sparkles className="h-4 w-4" aria-hidden="true" />
          {hasActiveStatus ? "Update status" : "Set status"}
        </Button>
      </div>

      <section className="rounded-2xl bg-card/55 p-2.5 shadow-sm dark:bg-white/[0.035] sm:p-3.5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold uppercase tracking-wide",
                // Orange is reserved for glow/proximity states (the ring and
                // the chips below); this is a general on/off toggle, so it
                // gets a distinct blue instead of doubling up on orange.
                ghostMode ? "bg-secondary text-muted-foreground" : "bg-blue-500/10 text-blue-700 dark:text-blue-300"
              )}
            >
              <span className={cn("h-1.5 w-1.5 rounded-full", ghostMode ? "bg-muted-foreground" : "bg-blue-500")} />
              {ghostMode ? "Visibility paused" : "Visibility on"}
            </span>

            {!ghostMode ? (
              <div className="flex flex-wrap gap-1.5">
                {proximityCounts.very_close > 0 ? (
                  <CountPill count={proximityCounts.very_close} label="very close" />
                ) : null}
                {proximityCounts.nearby > 0 ? <CountPill count={proximityCounts.nearby} label="nearby" /> : null}
                {proximityCounts.around > 0 ? <CountPill count={proximityCounts.around} label="around" /> : null}
              </div>
            ) : null}
          </div>

          <div className="flex shrink-0 flex-wrap gap-2">
            <Button
              type="button"
              variant={ghostMode ? "primary" : "outline"}
              className={ghostMode ? undefined : "border-border bg-secondary/60 hover:bg-secondary"}
              onClick={toggleVisibility}
              disabled={isPending}
              aria-label={ghostMode ? "Resume visibility" : "Pause visibility"}
            >
              <Ghost className="h-4 w-4" aria-hidden="true" />
              {ghostMode ? "Resume visibility" : "Pause visibility"}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="border-border bg-secondary/60 hover:bg-secondary"
              onClick={updatePrivateLocation}
              disabled={isPending}
              aria-label="Check again"
              title="Check again"
            >
              <RefreshCcw className={cn("h-4 w-4", isPending && "animate-spin motion-reduce:animate-none")} aria-hidden="true" />
            </Button>
          </div>
        </div>

        <p className="mt-1.5 truncate text-xs text-muted-foreground" role="status">
          {statusMessage ||
            (ghostMode
              ? "You won’t appear nearby until you turn visibility back on."
              : "Approved Muddies can see when you’re nearby.")}
        </p>
      </section>

      <QuickActions />

      <div className="grid gap-5 lg:grid-cols-3">
        <section className="lg:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-semibold tracking-tight">Nearby Muddies</h2>
            {hasMoreNearbyFriends ? (
              <Link href="/friends" className="text-sm font-medium text-primary hover:underline">
                View all
              </Link>
            ) : null}
          </div>

          {nearbyFriends.length > 0 ? (
            // minmax(240px) rather than the requested 260-280px: at the
            // page's 1200px max-width and this section's 65% share, three
            // literal 260px cards plus gaps don't fit (812px needed vs
            // ~770px available). 240px is the largest floor that still
            // yields three columns here, auto-fill's 1fr stretches each
            // card to ~250-260px in practice, close to the target width
            // while actually delivering the requested three-per-row.
            <div
              className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(240px,1fr))]"
              aria-label="Nearby Muddies"
            >
              {nearbyFriends.map((friend) => {
                // The username is the reliable fallback if a profile has no
                // full_name; it's also shown for disambiguation when two
                // friends share the same display name.
                const name = friend.displayName || friend.username;
                const showUsername = duplicateDisplayNames.has(name.toLowerCase());
                return (
                  <button
                    key={friend.friendId}
                    type="button"
                    onClick={() => setSelectedFriendId(friend.friendId)}
                    className="focus-ring safe-motion flex min-h-[104px] items-center gap-3 rounded-2xl border border-border/70 bg-card/50 p-4 text-left hover:bg-secondary/40"
                  >
                    <GlowAvatar
                      name={name}
                      src={friend.avatarUrl}
                      proximityLevel={friend.proximityLevel}
                      glowStrength={friend.glowStrength}
                      confidence={friend.confidence}
                      size="md"
                      reducedMotion={reducedMotion}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{capitalize(name)}</p>
                      {showUsername ? (
                        <p className="truncate text-xs text-foreground/70">@{friend.username}</p>
                      ) : null}
                      <span className="mt-1 inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                        {proximityLabels[friend.proximityLevel]}
                      </span>
                      {friend.muddyStatusLabel ? (
                        <p className="mt-1 truncate text-xs text-muted-foreground">{friend.muddyStatusLabel}</p>
                      ) : null}
                    </div>
                  </button>
                );
              })}
            </div>
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

        <section className="lg:col-span-1">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-semibold tracking-tight">Recent activity</h2>
            {unreadActivityCount > attentionItems.length ? (
              <Link href="/notifications" className="text-sm font-medium text-primary hover:underline">
                View all
              </Link>
            ) : null}
          </div>

          {attentionItems.length > 0 ? (
            <ul className="divide-y divide-border/60 rounded-2xl border border-border/70 bg-card/40">
              {attentionItems.map((item) => (
                <li key={item.id}>
                  <Link
                    href="/notifications"
                    className="focus-ring safe-motion flex min-h-[68px] items-center gap-3 px-4 py-3.5 hover:bg-secondary/50"
                  >
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
                      <item.icon className="h-4 w-4" aria-hidden="true" />
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm">{capitalize(item.title)}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">{item.time}</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="rounded-2xl border border-border/70 bg-card/40 px-4 py-3 text-sm text-muted-foreground">
              No recent activity
            </p>
          )}
        </section>
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
        hasActiveStatus={hasActiveStatus}
        initialAvailability={initialStatusAvailability}
        initialActivity={initialStatusActivity}
        initialNote={initialStatusNote}
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

function CountPill({ label, count }: { label: string; count: number }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-border bg-secondary px-2.5 py-1 text-xs font-medium text-foreground">
      {count} {label}
    </span>
  );
}

// Compact entry points to the temporary/active features users reach for most
// often. Each links to its existing route (nothing here duplicates that
// feature's own logic or invents new backend behaviour); the live
// active-state surfacing (e.g. "Available until 7pm") is a follow-up that
// needs its own data read.
const quickActions: Array<{
  href: "/hangout-mode" | "/safe-arrival" | "/plans";
  title: string;
  description: string;
  icon: LucideIcon;
}> = [
  {
    href: "/hangout-mode",
    title: "Hangout Mode",
    description: "Let your Muddies know you’re open to meeting.",
    icon: Hand
  },
  {
    href: "/safe-arrival",
    title: "Safe Arrival",
    description: "Ask trusted Muddies to confirm you arrived safely.",
    icon: ShieldCheck
  },
  {
    href: "/plans",
    title: "New plan",
    description: "Invite your Muddies and organise a meet-up.",
    icon: CalendarCheck2
  }
];

function QuickActions() {
  return (
    <section aria-label="Quick actions">
      <h2 className="mb-3 text-lg font-semibold tracking-tight">Quick actions</h2>
      <div className="grid gap-3 sm:grid-cols-3">
        {quickActions.map((action) => (
          <Link
            key={action.href}
            href={action.href}
            className="focus-ring safe-motion flex items-start gap-3 rounded-2xl border border-border/70 bg-card/50 p-4 hover:bg-secondary/40"
          >
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
              <action.icon className="h-4 w-4" aria-hidden="true" />
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-semibold">{action.title}</span>
              <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">{action.description}</span>
            </span>
          </Link>
        ))}
      </div>
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
