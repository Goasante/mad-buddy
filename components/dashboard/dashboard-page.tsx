"use client";

import Link from "next/link";
import type { Route } from "next";
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleDollarSign,
  Eye,
  EyeOff,
  MapPin,
  MessageSquareText,
  RefreshCcw,
  X
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { createMeetupRequestAction } from "@/app/(app)/premium-actions";
import { updateVisibilityStatusAction } from "@/app/(app)/settings-actions";
import { PendingInvitePrompt } from "@/components/discovery/pending-invite-prompt";
import { GlowAvatar } from "@/components/glow/glow-avatar";
import { MuddyProfileModal } from "@/components/glow/muddy-profile-modal";
import { ProfileCompletionReminder } from "@/components/profile/profile-completion-reminder";
import {
  ContactInvitationHomeCard,
  ContactJourneyHomeCard,
  TravellerJourneyHomeCard
} from "@/components/safety/safe-arrival-home-cards";
import { StatusComposer } from "@/components/social/status-composer";
import { Button } from "@/components/ui/button";
import { CarouselDots } from "@/components/ui/carousel-dots";
import { FeatureIcon } from "@/components/ui/feature-icon";
import { useHorizontalPages } from "@/hooks/use-horizontal-pages";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import type { FeatureIconKey } from "@/lib/icons/feature-icons";
import { fetchWithTimeout } from "@/lib/network/resilience";
import { type FreshnessState } from "@/lib/proximity/freshness";
import { proximityLabels, type ConfidenceLevel, type ProximityLevel } from "@/lib/proximity";
import type { SafeArrivalJourney } from "@/lib/safety/safe-arrival-service";
import { formatMuddyStatusLabel } from "@/lib/social/rules";
import type { HomeUpcomingPlan } from "@/lib/social/upcoming-plans";
import type { ActivityType, AvailabilityType, SubscriptionPlan } from "@/lib/supabase/database.types";
import { cn } from "@/lib/utils";

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

type DashboardPageContentProps = {
  subscriptionPlan?: SubscriptionPlan;
  hasPremium?: boolean;
  initialVisibilityStatus?: "visible" | "ghost" | "app_open_only";
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
  safeArrival?: {
    travelling: SafeArrivalJourney[];
    checkingOn: SafeArrivalJourney[];
    invitations: SafeArrivalJourney[];
  } | null;
  hiddenQuickActionHrefs?: string[];
  momentsSection?: ReactNode;
};

const PROXIMITY_ORDER: Record<ProximityLevel, number> = {
  very_close: 0,
  nearby: 1,
  around: 2,
  far: 3,
  hidden: 4
};

const AVAILABILITY_LABEL: Record<AvailabilityType, string> = {
  free: "Free",
  open_to_hang_out: "Open to hang out",
  maybe_available: "Maybe free",
  busy: "Busy",
  do_not_disturb: "Do not disturb"
};

const PROXIMITY_LABEL_CLASS: Partial<Record<ProximityLevel, string>> = {
  very_close: "bg-primary/12 text-primary",
  nearby: "bg-orange-500/10 text-orange-600 dark:text-orange-300",
  around: "bg-amber-500/10 text-amber-700 dark:text-amber-300"
};

function capitalize(name: string) {
  return name ? name.charAt(0).toUpperCase() + name.slice(1) : name;
}

function initialOf(name: string) {
  return name.trim().charAt(0).toUpperCase() || "?";
}

function statusDisplay(note?: string, availability?: AvailabilityType): string {
  const trimmed = note?.trim();
  if (trimmed) return trimmed;
  return availability ? AVAILABILITY_LABEL[availability] : "Status on";
}

export function DashboardPageContent({
  subscriptionPlan = "free",
  hasPremium = false,
  initialVisibilityStatus = "visible",
  hasActiveStatus = false,
  initialStatusAvailability,
  initialStatusActivity = null,
  initialStatusNote = "",
  upcomingPlans = [],
  hasMorePlans = false,
  glowColorByFriendId = {},
  profileReminder = null,
  safeArrival = null,
  hiddenQuickActionHrefs = [],
  momentsSection = null
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
  const [isPending, startTransition] = useTransition();
  const locationUpdateInFlightRef = useRef(false);
  const nearbyRefreshRef = useRef<Promise<void> | null>(null);
  const promptFeedbackTimerRef = useRef<number | null>(null);

  const visibleFriends = ghostMode ? [] : friends;
  const nearbyFriends = useMemo(
    () =>
      (ghostMode ? [] : friends)
        .filter(
          (friend) =>
            friend.proximityLevel === "very_close" ||
            friend.proximityLevel === "nearby" ||
            friend.proximityLevel === "around"
        )
        .sort(
          (a, b) =>
            PROXIMITY_ORDER[a.proximityLevel] - PROXIMITY_ORDER[b.proximityLevel] ||
            b.glowStrength - a.glowStrength
        ),
    [friends, ghostMode]
  );
  const selectedFriend = visibleFriends.find((friend) => friend.friendId === selectedFriendId) ?? null;

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
    if (nearbyRefreshRef.current) return nearbyRefreshRef.current;

    const refresh = (async () => {
      try {
        const response = await fetchWithTimeout(
          "/api/friends/nearby",
          { method: "GET", credentials: "include" },
          12_000,
          "load nearby friends"
        );

        if (!response.ok) {
          const error = (await response.json().catch(() => ({ error: "Could not refresh nearby friends." }))) as {
            error?: string;
          };
          setStatusMessage(error.error ?? "Could not refresh nearby friends.");
          return;
        }

        const data = (await response.json()) as { friends: NearbyFriendApiItem[] };
        setFriends(data.friends.map(toDashboardFriend));
        setStatusMessage("");
      } catch {
        setStatusMessage("Could not reach the nearby friends service.");
      } finally {
        nearbyRefreshRef.current = null;
      }
    })();

    nearbyRefreshRef.current = refresh;
    startTransition(async () => refresh);
    return refresh;
  }, []);

  const updatePrivateLocation = useCallback(() => {
    if (locationUpdateInFlightRef.current) return;

    if (!("geolocation" in navigator)) {
      setStatusMessage("This browser does not support location permission.");
      return;
    }

    locationUpdateInFlightRef.current = true;
    setIsCheckingNearby(true);
    setStatusMessage("");
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        try {
          const response = await fetchWithTimeout(
            "/api/location/update",
            {
              method: "POST",
              credentials: "include",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                latitude: position.coords.latitude,
                longitude: position.coords.longitude,
                accuracy: position.coords.accuracy
              })
            },
            15_000,
            "update dashboard proximity"
          );

          if (!response.ok) {
            const data = (await response.json().catch(() => null)) as { error?: string } | null;
            setStatusMessage(data?.error ?? "Could not update your private proximity signal.");
            return;
          }

          void loadNearbyFriends();
        } catch {
          setStatusMessage("Could not update your private proximity signal.");
        } finally {
          locationUpdateInFlightRef.current = false;
          setIsCheckingNearby(false);
        }
      },
      (error) => {
        locationUpdateInFlightRef.current = false;
        setIsCheckingNearby(false);
        if (error.code === error.PERMISSION_DENIED) {
          setStatusMessage("Location access is blocked. Allow it in this browser's site settings, then refresh.");
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
    void loadNearbyFriends();
  }, [loadNearbyFriends]);

  useEffect(
    () => () => {
      if (promptFeedbackTimerRef.current) window.clearTimeout(promptFeedbackTimerRef.current);
    },
    []
  );

  useEffect(() => {
    const handleLocationUpdated = () => void loadNearbyFriends();
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
      if (!result.ok) return;
      setGhostMode(nextGhostMode);
      window.dispatchEvent(
        new CustomEvent("mad-buddy:location-sync-status", { detail: { enabled: !nextGhostMode } })
      );
      if (!nextGhostMode) updatePrivateLocation();
    });
  }

  function sendConnectionPrompt(friendId: string, message: string) {
    showPromptFeedback("Sending...");
    startTransition(async () => {
      try {
        const result = await createMeetupRequestAction({ receiverId: friendId, message });
        showPromptFeedback(result.message, !result.ok);
      } catch {
        showPromptFeedback("Couldn't send your message. Try again.", true);
      }
    });
  }

  const plan = upcomingPlans[0];
  const activeSafeArrivalCount =
    (safeArrival?.travelling.length ?? 0) + (safeArrival?.checkingOn.length ?? 0);
  const safeArrivalInviteCount = safeArrival?.invitations.length ?? 0;

  return (
    <div className="mx-auto w-full max-w-[920px] space-y-6 pt-4 sm:pt-6">
      <SubscriptionStatusPortal plan={subscriptionPlan} hasPremium={hasPremium} />
      <PendingInvitePrompt />

      <div className="flex items-center gap-2 overflow-x-auto pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <button
          type="button"
          onClick={toggleVisibility}
          disabled={isPending}
          aria-label={ghostMode ? "Resume visibility" : "Pause visibility"}
          title={ghostMode ? "Resume visibility" : "Pause visibility"}
          className={cn(
            "focus-ring safe-motion inline-flex h-10 shrink-0 items-center gap-2 rounded-full border px-3 text-sm font-semibold",
            ghostMode
              ? "border-border bg-secondary/60 text-muted-foreground"
              : "border-emerald-500/30 bg-emerald-500/10 text-foreground"
          )}
        >
          {ghostMode ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
          {ghostMode ? "Paused" : "Visible"}
          <span className={cn("h-2 w-2 rounded-full", ghostMode ? "bg-muted-foreground/60" : "bg-emerald-500")} aria-hidden="true" />
        </button>

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
              className="focus-ring safe-motion inline-flex h-10 max-w-[190px] shrink-0 items-center gap-2 rounded-full border border-border/70 bg-card/60 px-3 text-sm font-semibold hover:bg-secondary/60"
            >
              <MessageSquareText className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
              <span className="truncate">
                {hasActiveStatus ? statusDisplay(initialStatusNote, initialStatusAvailability) : "Link up?"}
              </span>
              <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            </button>
          }
        />

        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={updatePrivateLocation}
          disabled={isPending}
          aria-label="Check nearby Muddies again"
          title="Check nearby Muddies again"
          className="h-10 w-10 shrink-0 rounded-full border border-border/70"
        >
          <RefreshCcw
            className={cn("h-4 w-4", isCheckingNearby && "animate-spin motion-reduce:animate-none")}
            aria-hidden="true"
          />
        </Button>
      </div>

      {statusMessage || isCheckingNearby ? (
        <p className="-mt-4 text-xs text-muted-foreground" role="status">
          {isCheckingNearby ? "Checking nearby Muddies…" : statusMessage}
        </p>
      ) : null}

      <NearbyHero
        friends={nearbyFriends}
        ghostMode={ghostMode}
        glowColorByFriendId={glowColorByFriendId}
        reducedMotion={reducedMotion}
        onSelect={setSelectedFriendId}
      />

      <HappeningNow
        upcomingPlanCount={upcomingPlans.length}
        hasMorePlans={hasMorePlans}
        activeSafeArrivalCount={activeSafeArrivalCount}
        safeArrivalInviteCount={safeArrivalInviteCount}
        hiddenHrefs={hiddenQuickActionHrefs}
      />

      {plan ? <UpcomingPlanRow plan={plan} /> : null}
      {momentsSection}

      {safeArrival &&
      (safeArrival.travelling.length > 0 ||
        safeArrival.checkingOn.length > 0 ||
        safeArrival.invitations.length > 0) ? (
        <section aria-labelledby="home-safe-arrival-heading" className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <h2 id="home-safe-arrival-heading" className="text-sm font-semibold">
              Safe Arrival
            </h2>
            <Link href="/safe-arrival" prefetch={false} className="text-xs font-medium text-primary hover:underline">
              Open
            </Link>
          </div>
          {safeArrival.invitations.map((journey) => (
            <ContactInvitationHomeCard key={journey.id} journey={journey} />
          ))}
          {safeArrival.travelling.map((journey) => (
            <TravellerJourneyHomeCard key={journey.id} journey={journey} />
          ))}
          {safeArrival.checkingOn.map((journey) => (
            <ContactJourneyHomeCard key={journey.id} journey={journey} />
          ))}
        </section>
      ) : null}

      {profileReminder ? (
        <ProfileCompletionReminder userId={profileReminder.userId} missingItems={profileReminder.missingItems} />
      ) : null}

      {promptFeedback ? (
        <div
          role="status"
          aria-live="polite"
          onMouseEnter={pauseToastDismiss}
          onMouseLeave={scheduleToastDismiss}
          onFocus={pauseToastDismiss}
          onBlur={scheduleToastDismiss}
          className="toast-in fixed bottom-[calc(96px+env(safe-area-inset-bottom))] left-1/2 z-50 w-[calc(100%-2rem)] max-w-[320px] -translate-x-1/2 md:bottom-6"
        >
          <div className="flex items-start gap-2.5 rounded-xl border border-white/10 bg-[#1b1b1d] px-4 py-3 text-white shadow-lg">
            <span className={cn("mt-0.5 shrink-0", promptFeedback.error ? "text-red-400" : "text-emerald-400")}>
              {promptFeedback.error ? <AlertTriangle className="h-4 w-4" aria-hidden="true" /> : <CheckCircle2 className="h-4 w-4" aria-hidden="true" />}
            </span>
            <div className="min-w-0 flex-1">
              {promptFeedback.title ? <p className="text-sm font-semibold leading-5">{promptFeedback.title}</p> : null}
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

function NearbyHero({
  friends,
  ghostMode,
  glowColorByFriendId,
  reducedMotion,
  onSelect
}: {
  friends: DashboardFriend[];
  ghostMode: boolean;
  glowColorByFriendId: Record<string, string>;
  reducedMotion: boolean;
  onSelect: (friendId: string) => void;
}) {
  const { scrollRef, pageCount, activePage, goToPage } = useHorizontalPages(friends.length);

  return (
    <section aria-labelledby="home-nearby-heading" data-tour-id="home-nearby">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 id="home-nearby-heading" className="text-lg font-semibold tracking-tight">
          Nearby Muddies
        </h2>
        <Link
          href="/friends"
          prefetch={false}
          className="focus-ring safe-motion inline-flex items-center rounded-full px-2 py-1 text-sm font-semibold text-primary hover:bg-primary/10"
        >
          View all <span aria-hidden="true">›</span>
        </Link>
      </div>

      {friends.length > 0 ? (
        <>
          <div
            ref={scrollRef}
            className="glow-strip glow-scroll-boundary -mx-2 flex snap-x snap-mandatory gap-4 overflow-x-auto px-4 pb-2 pt-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            aria-label="Nearby Muddies"
          >
            {friends.map((friend) => {
              const name = friend.displayName || friend.username;
              return (
                <button
                  key={friend.friendId}
                  type="button"
                  onClick={() => onSelect(friend.friendId)}
                  className="focus-ring safe-motion flex w-[78px] shrink-0 snap-start flex-col items-center gap-1.5 text-center"
                  aria-label={`${capitalize(name)}, ${proximityLabels[friend.proximityLevel]}`}
                >
                  <span className="relative">
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
                    {friend.freshnessState === "live" ? (
                      <span className="absolute bottom-0 right-0 z-[2] h-3 w-3 rounded-full border-2 border-background bg-emerald-500" aria-hidden="true" />
                    ) : null}
                  </span>
                  <span className="mt-0.5 w-full truncate text-xs font-semibold">{capitalize(name)}</span>
                  <span
                    className={cn(
                      "inline-flex max-w-full items-center truncate rounded-full px-2 py-0.5 text-[10px] font-semibold",
                      PROXIMITY_LABEL_CLASS[friend.proximityLevel] ?? "bg-primary/10 text-primary"
                    )}
                  >
                    {proximityLabels[friend.proximityLevel]}
                  </span>
                </button>
              );
            })}
          </div>
          <CarouselDots count={pageCount} active={activePage} onSelect={goToPage} label="Nearby Muddies" />
        </>
      ) : (
        <div className="rounded-2xl bg-secondary/35 px-4 py-5 text-center">
          <p className="text-sm font-semibold">{ghostMode ? "Visibility is paused" : "No Muddies nearby"}</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            {ghostMode ? "Resume visibility to check nearby." : "Approved Muddies will glow here when they're around."}
          </p>
          {!ghostMode ? (
            <Link
              href="/friends?tab=add"
              prefetch={false}
              className="focus-ring safe-motion mt-2 inline-flex rounded-full px-3 py-1.5 text-xs font-semibold text-primary hover:bg-primary/10"
            >
              Add Muddies
            </Link>
          ) : null}
        </div>
      )}
    </section>
  );
}

type HappeningFeature = {
  href: Route;
  label: string;
  description: string;
  featureIcon: FeatureIconKey;
  accentClass: string;
  surfaceClass: string;
};

function HappeningNow({
  upcomingPlanCount,
  hasMorePlans,
  activeSafeArrivalCount,
  safeArrivalInviteCount,
  hiddenHrefs
}: {
  upcomingPlanCount: number;
  hasMorePlans: boolean;
  activeSafeArrivalCount: number;
  safeArrivalInviteCount: number;
  hiddenHrefs: string[];
}) {
  const planDescription =
    upcomingPlanCount === 0
      ? "Make something happen"
      : hasMorePlans
        ? "Plans coming up"
        : `${upcomingPlanCount} upcoming`;
  const safeArrivalDescription =
    activeSafeArrivalCount > 0
      ? `${activeSafeArrivalCount} in transit`
      : safeArrivalInviteCount > 0
        ? `${safeArrivalInviteCount} request${safeArrivalInviteCount === 1 ? "" : "s"} waiting`
        : "Get home safely";

  const features: HappeningFeature[] = [
    {
      href: "/hangout-mode",
      label: "Hangout",
      description: "See who's free",
      featureIcon: "hangout",
      accentClass: "text-orange-500",
      surfaceClass: "bg-orange-500/10"
    },
    {
      href: "/discover",
      label: "Socialize",
      description: "Meet people nearby",
      featureIcon: "socialize",
      accentClass: "text-violet-500",
      surfaceClass: "bg-violet-500/10"
    },
    {
      href: "/plans",
      label: "Plans",
      description: planDescription,
      featureIcon: "plans",
      accentClass: "text-sky-500",
      surfaceClass: "bg-sky-500/10"
    },
    {
      href: "/safe-arrival",
      label: "Safe Arrival",
      description: safeArrivalDescription,
      featureIcon: "safeArrival",
      accentClass: "text-emerald-500",
      surfaceClass: "bg-emerald-500/10"
    },
    {
      href: "/events",
      label: "Events",
      description: "See what's on",
      featureIcon: "events",
      accentClass: "text-fuchsia-500",
      surfaceClass: "bg-fuchsia-500/10"
    }
  ];

  const visibleFeatures = features.filter((feature) => !hiddenHrefs.includes(feature.href));

  return (
    <section aria-labelledby="home-happening-heading">
      <h2 id="home-happening-heading" className="mb-3 text-lg font-semibold tracking-tight">
        What&apos;s happening now
      </h2>
      <div className="-mx-1 flex snap-x gap-3 overflow-x-auto px-1 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {visibleFeatures.map((feature) => (
          <Link
            key={feature.href}
            href={feature.href}
            prefetch={false}
            className={cn(
              "focus-ring safe-motion flex min-h-[108px] w-[124px] shrink-0 snap-start flex-col justify-between rounded-2xl p-3 hover:-translate-y-0.5",
              feature.surfaceClass
            )}
          >
            <span className={cn("grid h-9 w-9 place-items-center rounded-full bg-background/75", feature.accentClass)}>
              <FeatureIcon feature={feature.featureIcon} size={19} decorative />
            </span>
            <span>
              <span className="block text-sm font-semibold">{feature.label}</span>
              <span className="mt-0.5 block text-[11px] leading-4 text-muted-foreground">{feature.description}</span>
            </span>
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
      return "Respond";
  }
}

function UpcomingPlanRow({ plan }: { plan: HomeUpcomingPlan }) {
  const when = new Date(plan.startAt).toLocaleString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });

  return (
    <section aria-labelledby="home-plan-heading">
      <div className="mb-2 flex items-center justify-between">
        <h2 id="home-plan-heading" className="text-sm font-semibold">
          Upcoming
        </h2>
        <Link href="/plans" prefetch={false} className="text-xs font-medium text-primary hover:underline">
          All plans
        </Link>
      </div>
      <Link
        href="/plans"
        prefetch={false}
        aria-label={`${capitalize(plan.title)}, ${when}, ${rsvpLabel(plan.myRsvp)}`}
        className="focus-ring safe-motion flex items-center gap-3 rounded-2xl border border-border/70 bg-card/50 p-3 hover:border-border hover:bg-secondary/40"
      >
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
          <CalendarDays className="h-[18px] w-[18px]" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{capitalize(plan.title)}</p>
          <p className="mt-0.5 truncate text-xs text-muted-foreground" suppressHydrationWarning>
            {when}
            {plan.placeText ? (
              <>
                {" · "}
                <MapPin className="mr-0.5 inline-block h-3 w-3 -translate-y-px" aria-hidden="true" />
                {capitalize(plan.placeText)}
              </>
            ) : null}
          </p>
        </div>
        {plan.attendees.length > 0 ? (
          <span className="hidden shrink-0 -space-x-1.5 min-[400px]:flex" aria-hidden="true">
            {plan.attendees.slice(0, 3).map((attendee, index) => (
              <span
                key={`${attendee.name}-${index}`}
                className="grid h-6 w-6 place-items-center overflow-hidden rounded-full border-2 border-background bg-secondary text-[9px] font-semibold uppercase text-muted-foreground"
              >
                {attendee.avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={attendee.avatarUrl} alt="" className="h-full w-full object-cover" />
                ) : (
                  initialOf(attendee.name)
                )}
              </span>
            ))}
          </span>
        ) : null}
        <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-primary/12 px-2 py-0.5 text-xs font-semibold text-primary">
          {rsvpLabel(plan.myRsvp)}
          <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
        </span>
      </Link>
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
      prefetch={false}
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
