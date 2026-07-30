"use client";

import Link from "next/link";
import type { Route } from "next";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  CircleDollarSign,
  Eye,
  EyeOff,
  RefreshCcw,
  Smile,
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

  const activeSafeArrivalCount =
    (safeArrival?.travelling.length ?? 0) + (safeArrival?.checkingOn.length ?? 0);
  const safeArrivalInviteCount = safeArrival?.invitations.length ?? 0;

  return (
    <div className="mx-auto w-full max-w-[680px] space-y-4 pt-2 sm:pt-4 md:space-y-6">
      <SubscriptionStatusPortal plan={subscriptionPlan} hasPremium={hasPremium} />
      <PendingInvitePrompt />

      <div className="flex items-center justify-end gap-1.5 overflow-x-auto pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden md:justify-start md:gap-2">
        <button
          type="button"
          onClick={toggleVisibility}
          disabled={isPending}
          aria-label={ghostMode ? "Resume visibility" : "Pause visibility"}
          title={ghostMode ? "Resume visibility" : "Pause visibility"}
          className={cn(
            "focus-ring safe-motion inline-flex h-7 min-w-[44px] shrink-0 items-center justify-center gap-1.5 rounded-full border px-2.5 text-[10px] font-semibold md:h-10 md:gap-2 md:px-3 md:text-sm",
            ghostMode
              ? "border-border bg-secondary/60 text-muted-foreground"
              : "border-emerald-500/30 bg-emerald-500/10 text-foreground"
          )}
        >
          {ghostMode ? <EyeOff className="h-3 w-3 md:h-4 md:w-4" aria-hidden="true" /> : <Eye className="h-3 w-3 md:h-4 md:w-4" aria-hidden="true" />}
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
              className="focus-ring safe-motion inline-flex h-7 min-w-[44px] max-w-[130px] shrink-0 items-center justify-center gap-1.5 rounded-full border border-border/70 bg-card/60 px-2.5 text-[10px] font-semibold hover:bg-secondary/60 md:h-10 md:max-w-[190px] md:gap-2 md:px-3 md:text-sm"
            >
              <Smile className="h-3 w-3 shrink-0 text-violet-500 md:h-4 md:w-4" aria-hidden="true" />
              <span className="truncate">
                {hasActiveStatus ? statusDisplay(initialStatusNote, initialStatusAvailability) : "Link up?"}
              </span>
              <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground md:h-3.5 md:w-3.5" aria-hidden="true" />
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
          className="hidden h-10 w-10 shrink-0 rounded-full border border-border/70 md:inline-flex"
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
      <div className="mb-2 flex items-center justify-between gap-3 md:mb-3">
        <h2 id="home-nearby-heading" className="text-[13px] font-semibold tracking-tight md:text-lg">
          Nearby Muddies
        </h2>
        <Link
          href="/friends"
          prefetch={false}
          className="focus-ring safe-motion inline-flex min-h-[28px] items-center rounded-full px-2 py-1 text-[10px] font-semibold text-primary hover:bg-primary/10 md:text-sm"
        >
          View all <span aria-hidden="true">›</span>
        </Link>
      </div>

      {friends.length > 0 ? (
        <>
          <div
            ref={scrollRef}
            className="glow-strip glow-scroll-boundary -mx-2 flex snap-x snap-mandatory gap-1.5 overflow-x-auto px-2 pb-1 pt-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden md:gap-4 md:px-4 md:pb-2 md:pt-3"
            aria-label="Nearby Muddies"
          >
            {friends.map((friend) => {
              const name = friend.displayName || friend.username;
              return (
                <button
                  key={friend.friendId}
                  type="button"
                  onClick={() => onSelect(friend.friendId)}
                  className="focus-ring safe-motion flex min-h-[94px] w-[66px] shrink-0 snap-start flex-col items-center gap-1 text-center md:w-[78px] md:gap-1.5"
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
                  <span className="w-full truncate text-[10px] font-semibold md:mt-0.5 md:text-xs">{capitalize(name)}</span>
                  <span
                    className={cn(
                      "inline-flex max-w-full items-center truncate rounded-full px-1.5 py-0.5 text-[8px] font-semibold md:px-2 md:text-[10px]",
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
        <div className="rounded-xl bg-secondary/35 px-3 py-3 text-center md:rounded-2xl md:px-4 md:py-5">
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
      <h2 id="home-happening-heading" className="mb-2 text-[13px] font-semibold tracking-tight md:mb-3 md:text-lg">
        What&apos;s happening now
      </h2>
      <div className="-mx-0.5 grid snap-x grid-flow-col auto-cols-[minmax(50px,1fr)] gap-1.5 overflow-x-auto px-0.5 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden md:flex md:gap-3 md:pb-2">
        {visibleFeatures.map((feature) => (
          <Link
            key={feature.href}
            href={feature.href}
            prefetch={false}
            className={cn(
              "focus-ring safe-motion flex min-h-[82px] min-w-[50px] snap-start flex-col items-center justify-between rounded-xl border border-current/20 p-1.5 text-center hover:-translate-y-0.5 md:min-h-[108px] md:w-[124px] md:shrink-0 md:items-start md:rounded-2xl md:p-3 md:text-left",
              feature.surfaceClass
            )}
          >
            <span className={cn("grid h-7 w-7 place-items-center rounded-lg bg-background/75 md:h-9 md:w-9 md:rounded-full", feature.accentClass)}>
              <FeatureIcon feature={feature.featureIcon} size={18} decorative />
            </span>
            <span>
              <span className="block text-[9px] font-semibold leading-3 md:text-sm md:leading-normal">{feature.label}</span>
              <span className="mt-0.5 line-clamp-2 block text-[7px] leading-[10px] text-muted-foreground md:text-[11px] md:leading-4">{feature.description}</span>
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
