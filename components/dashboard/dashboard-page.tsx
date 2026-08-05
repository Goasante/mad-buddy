"use client";

import Link from "next/link";
import type { Route } from "next";
import {
  AlertTriangle,
  Bell,
  CalendarPlus,
  CheckCircle2,
  ChevronRight,
  CalendarDays,
  CircleDollarSign,
  Compass,
  Ghost,
  GraduationCap,
  Hand,
  LayoutGrid,
  MapPin,
  MessageSquareText,
  Moon,
  PartyPopper,
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
import { updateVisibilityStatusAction } from "@/app/(app)/settings-actions";
import { MobilePageHeader } from "@/components/app-shell/mobile-page-header";
import { useUnreadNotifications } from "@/hooks/unread-notification-context";
import { usePullRefreshListener } from "@/components/ui/pull-to-refresh";
import type { PublicMembershipTier } from "@/lib/billing/premium-identity";
import { HomeSettingsSheet } from "@/components/dashboard/home-settings-sheet";
import { QuickControlsSheet } from "@/components/dashboard/quick-controls-sheet";
import { GlowAvatar } from "@/components/glow/glow-avatar";
import { MuddyProfileModal } from "@/components/glow/muddy-profile-modal";
import { PendingInvitePrompt } from "@/components/discovery/pending-invite-prompt";
import { ProfileCompletionReminder } from "@/components/profile/profile-completion-reminder";
import {
  ContactInvitationHomeCard,
  ContactJourneyHomeCard,
  TravellerJourneyHomeCard
} from "@/components/safety/safe-arrival-home-cards";
import type { SafeArrivalJourney } from "@/lib/safety/safe-arrival-service";
import { StatusComposer } from "@/components/social/status-composer";
import { FeatureIcon } from "@/components/ui/feature-icon";
import { Modal } from "@/components/ui/modal";
import type { FeatureIconKey } from "@/lib/icons/feature-icons";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { fetchWithTimeout } from "@/lib/network/resilience";
import { formatMuddyStatusLabel } from "@/lib/social/rules";
import type { HomeUpcomingPlan } from "@/lib/social/upcoming-plans";
import { type FreshnessState } from "@/lib/proximity/freshness";
import { proximityLabels, type ConfidenceLevel, type ProximityLevel } from "@/lib/proximity";
import type { ActivityType, AvailabilityType, SubscriptionPlan } from "@/lib/supabase/database.types";
import { cn } from "@/lib/utils";
import { TOUR_TARGET_IDS } from "@/lib/tours/registry";
import { SmartCardHero } from "@/components/journey/smart-card";
import type { SmartCard } from "@/lib/smart-card/smart-card";

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
  membershipTier: PublicMembershipTier;
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
  membership_tier: PublicMembershipTier;
  confidence: ConfidenceLevel;
  muddy_availability: string | null;
  muddy_activity: string | null;
  muddy_status_note: string | null;
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
  /**
   * Canonical Safe Arrival journeys for this viewer, already privacy-filtered by
   * the server. Passed whole rather than flattened so the cards read real
   * per-contact state instead of re-deriving counts from an avatar list.
   */
  safeArrival?: {
    travelling: SafeArrivalJourney[];
    checkingOn: SafeArrivalJourney[];
    invitations: SafeArrivalJourney[];
  } | null;
  hiddenQuickActionHrefs?: string[];
  /**
   * The one card Home renders, already selected server-side by the Smart Card
   * engine. Home does not choose between cards and does not know the priority
   * rules — it renders whatever arrives.
   */
  smartCard?: SmartCard | null;
  /**
   * Canonical first-time signal, computed server-side from real Journey
   * progress (see app/(app)/dashboard/page.tsx) — never inferred client-side.
   * Swaps the Quick Actions set and the Nearby empty-state copy/CTA to the
   * activation-focused variant; everything else on Home behaves identically.
   */
  isFirstTimeUser?: boolean;
  currentUsername?: string | null;
  currentAvatarUrl?: string | null;
  /** Display label only ("Trusted Buddy"), for the account sheet's header. */
  buddyScoreLevelLabel?: string | null;
  /**
   * Pending INCOMING Muddy requests, from countIncomingRequests. Drives the
   * Add Muddy badge only — never notifications, outgoing requests,
   * suggestions or unread messages, each of which is counted elsewhere.
   */
  incomingRequestCount?: number;
};

/** Strongest proximity bucket first, then the brightest glow within a bucket. */
const PROXIMITY_ORDER: Record<ProximityLevel, number> = {
  close: 0,
  near: 1,
  far: 2,
  hidden: 3
};

/** Home shows at most four positions; a fifth+ collapses into a "+N" tile. */
const NEARBY_MAX_POSITIONS = 4;

function capitalize(name: string) {
  return name ? name.charAt(0).toUpperCase() + name.slice(1) : name;
}

/** First letter of a name for the attendee-avatar fallback. */
function initialOf(name: string) {
  return name.trim().charAt(0).toUpperCase() || "?";
}

/** Short status text for the compact card (custom note wins, else availability). */
const AVAILABILITY_LABEL: Record<AvailabilityType, string> = {
  free: "Free",
  open_to_hang_out: "Open to hang out",
  maybe_available: "Maybe free",
  busy: "Busy",
  do_not_disturb: "Do not disturb"
};

function statusDisplay(note?: string, availability?: AvailabilityType): string {
  const trimmed = note?.trim();
  if (trimmed) return trimmed;
  return availability ? AVAILABILITY_LABEL[availability] : "Status on";
}

/** Per-proximity accent for the label pill, matching the reference hues. */
const PROXIMITY_LABEL_CLASS: Partial<Record<ProximityLevel, string>> = {
  close: "bg-primary/12 text-primary",
  near: "bg-violet-500/15 text-violet-600 dark:text-violet-300",
  far: "bg-blue-500/15 text-blue-600 dark:text-blue-300"
};

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
  glowColorByFriendId = {},
  profileReminder = null,
  safeArrival = null,
  hiddenQuickActionHrefs = [],
  smartCard = null,
  isFirstTimeUser = false,
  currentUsername = null,
  currentAvatarUrl = null,
  buddyScoreLevelLabel = null,
  incomingRequestCount = 0
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
  const [settingsSheetOpen, setSettingsSheetOpen] = useState(false);
  const [quickControlsOpen, setQuickControlsOpen] = useState(false);
  // The shell's canonical unread count, read from context — not a second
  // counter, not another poller, and not derived from anything on this page.
  const unreadNotificationCount = useUnreadNotifications();
  const [isPending, startTransition] = useTransition();
  const locationUpdateInFlightRef = useRef(false);
  const nearbyRefreshRef = useRef<Promise<void> | null>(null);
  const promptFeedbackTimerRef = useRef<number | null>(null);

  const visibleFriends = !ghostMode ? friends : [];
  // The nearby endpoint also returns friends whose signal is stale ("hidden");
  // only close/near/far are a real "nearby" glance (everyone beyond the 15km
  // range is already excluded server-side). Sorted strongest-first so the
  // four preview positions show the closest Muddies. Memoised on the stable
  // inputs (friends, ghostMode) rather than the derived visibleFriends, so it
  // doesn't recompute every render.
  const nearbyFriends = useMemo(
    () =>
      (ghostMode ? [] : friends)
        .filter(
          (friend) =>
            friend.proximityLevel === "close" ||
            friend.proximityLevel === "near" ||
            friend.proximityLevel === "far"
        )
        .sort(
          (a, b) =>
            PROXIMITY_ORDER[a.proximityLevel] - PROXIMITY_ORDER[b.proximityLevel] || b.glowStrength - a.glowStrength
        ),
    [friends, ghostMode]
  );
  const selectedFriend = visibleFriends.find((friend) => friend.friendId === selectedFriendId) ?? null;
  const nearbyTotal = nearbyFriends.length;

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

  // Pull-to-refresh reuses THIS action — the same one Quick Controls'
  // "Refresh Nearby" calls. The shell owns the gesture and the indicator and
  // re-runs the server render; Home only says what client state to refetch,
  // so there is exactly one refresh implementation and no double fetch.
  usePullRefreshListener(loadNearbyFriends);

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

          loadNearbyFriends();
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
          new CustomEvent("mad-buddy:location-sync-status", { detail: { enabled: !nextGhostMode } })
        );
        if (!nextGhostMode) updatePrivateLocation();
      }
    });
  }

  function sendConnectionPrompt(friendId: string, message: string) {
    showPromptFeedback("Sending...");
    startTransition(async () => {
      try {
        const result = await createMeetupRequestAction({ receiverId: friendId, message });
        showPromptFeedback(result.message, !result.ok);
      } catch {
        showPromptFeedback("Couldn’t send your message. Try again.", true);
      }
    });
  }

  const plan = upcomingPlans[0];

  // Quick actions are split once here so the launcher row, the More sheet and
  // the bottom gap-filler stay in agreement: whatever the filler promotes is
  // removed from More, and returns to More when the space is needed again.
  const { primary: primaryActions, secondary: secondaryActions } = useMemo(
    () => splitQuickActions(hiddenQuickActionHrefs),
    [hiddenQuickActionHrefs]
  );
  const [promotedCount, setPromotedCount] = useState(0);
  const moreActions = useMemo(
    () => secondaryActions.slice(promotedCount),
    [secondaryActions, promotedCount]
  );

  const hasSafeArrival =
    safeArrival !== null &&
    (safeArrival.travelling.length > 0 || safeArrival.checkingOn.length > 0 || safeArrival.invitations.length > 0);

  return (
    <>
      {/* A faint Home-only wash, sitting above the shared shell wallpaper and
          below everything else here (fixed + -z-10, so it needs no
          positioning ancestor). Mobile-only, matching the compact header —
          desktop already has the shell's own ambient wallpaper layer.
          Day and Night both get the same treatment via CSS variables, so
          neither theme reads as the "unfinished" one. */}
      <div className="home-ambient-bg fixed inset-x-0 top-0 -z-10 h-[26rem] md:hidden" aria-hidden="true" />

      {/* The shared mobile header (components/app-shell/mobile-page-header).
          Home supplies the title, the two sheet openers and the pending
          incoming-request count; everything about layout, sizing, icons and
          press feedback lives in that one component so every primary screen
          renders an identical header. */}
      <MobilePageHeader
        title="Home"
        onOpenMenu={() => setSettingsSheetOpen(true)}
        onOpenQuickControls={() => setQuickControlsOpen(true)}
        incomingRequestCount={incomingRequestCount}
        // Two independent streams: unread notifications on the Bell, pending
        // incoming Muddy requests on Add Muddy. Never summed.
        unreadNotificationCount={unreadNotificationCount}
        // The visibility control moved into Quick Controls, and a shipped
        // walkthrough step still points at this id, so it stays attached to
        // wherever that control actually lives.
        quickControlsTourId={TOUR_TARGET_IDS.HOME_VISIBILITY}
      />

      {/* A focused, centred column — Home answers "who's nearby?" at a glance, so
          it stays narrow on every width rather than spreading into a dashboard.
          The header above already ends in its own pb-3, so this only adds the
          small remainder rather than a second full gap. */}
      <div className="mx-auto w-full max-w-[560px] space-y-5 pt-1">
        <SubscriptionStatusPortal plan={subscriptionPlan} hasPremium={hasPremium} />
        <PendingInvitePrompt />

        {/* Greeting — the page's title. A fixed "Welcome" rather than a
            time-of-day + name line; the subtitle below is state-derived,
            never a fixed line, so it always answers "what should I do, and
            why" — that's where the personality/personalisation lives now. */}
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-bold leading-tight tracking-tight">Welcome</h1>
          {/* Deliberately a step smaller than the body scale so the greeting
              itself stays clearly dominant. */}
          <p className="mt-1 text-[0.8125rem] leading-[1.45] text-muted-foreground">
            {greetingSubtitle(displayName || null, new Date())}
          </p>
        </div>

        {/* HERO: the Smart Card — Home's single canonical card and its main
            visual focal point. There is always exactly one, never a carousel,
            and it never disappears: the server picks the highest-priority
            applicable card from the ordered provider list, and only the
            content changes. profileReminder (below, near the visibility card)
            is a smaller secondary nudge, not a replacement. */}
        {smartCard ? <SmartCardHero card={smartCard} /> : null}

        {/* HERO: Nearby Muddies */}
        <NearbyHero
          friends={nearbyFriends}
          total={nearbyTotal}
          ghostMode={ghostMode}
          isFirstTimeUser={isFirstTimeUser}
          glowColorByFriendId={glowColorByFriendId}
          reducedMotion={reducedMotion}
          onSelect={setSelectedFriendId}
        />

        {/* Quick actions: first-time activation set, or the returning-user set. */}
        {isFirstTimeUser ? (
          <FirstTimeQuickActions />
        ) : (
          <QuickActionsHome primary={primaryActions} secondary={moreActions} />
        )}

        {/* Compact profile-completion banner (real state, dismissible). */}
        {profileReminder ? (
          <ProfileCompletionReminder userId={profileReminder.userId} missingItems={profileReminder.missingItems} />
        ) : null}

        {/* Safe Arrival on Home: my live journey, journeys I've accepted, and any
            invitation still awaiting my answer. Absent entirely when there is
            nothing live, so Home never carries an empty placeholder. */}
        {hasSafeArrival ? (
          <section aria-labelledby="home-safe-arrival-heading" className="space-y-2.5">
            <div className="flex items-center justify-between gap-3">
              <h2 id="home-safe-arrival-heading" className="text-sm font-semibold">
                Safe Arrival
              </h2>
              <Link href="/safe-arrival" prefetch={false} className="text-xs font-medium text-primary hover:underline">
                Open
              </Link>
            </div>
            {safeArrival!.invitations.map((journey) => (
              <ContactInvitationHomeCard key={journey.id} journey={journey} />
            ))}
            {safeArrival!.travelling.map((journey) => (
              <TravellerJourneyHomeCard key={journey.id} journey={journey} />
            ))}
            {safeArrival!.checkingOn.map((journey) => (
              <ContactJourneyHomeCard key={journey.id} journey={journey} />
            ))}
          </section>
        ) : null}

        {/* Compact upcoming plan — only when one genuinely exists. */}
        {plan ? <UpcomingPlanRow plan={plan} /> : null}

        {/* Fills leftover space above the bottom nav with extra shortcuts; they
            retract into "More" as soon as real content needs the room. Only for
            the returning-user quick-actions set — the first-time set is fixed. */}
        {!isFirstTimeUser ? (
          <HomeGapFillerActions pool={secondaryActions} onPromotedChange={setPromotedCount} />
        ) : null}
      </div>

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

      {/* Quick Controls. The four controls that used to sit permanently on
          Home (visibility, status, ghost state, refresh nearby) live here
          now. State and server actions stay in this component — the sheet is
          presentation, so there is still one implementation of each. */}
      <QuickControlsSheet
        open={quickControlsOpen}
        onOpenChange={setQuickControlsOpen}
        ghostMode={ghostMode}
        isPending={isPending}
        isCheckingNearby={isCheckingNearby}
        statusMessage={statusMessage}
        statusSummary={statusDisplay(initialStatusNote, initialStatusAvailability)}
        hasActiveStatus={hasActiveStatus}
        onToggleVisibility={toggleVisibility}
        onRefreshNearby={updatePrivateLocation}
        statusTrigger={
          <StatusComposer
            hasActiveStatus={hasActiveStatus}
            initialAvailability={initialStatusAvailability}
            initialActivity={initialStatusActivity}
            initialNote={initialStatusNote}
            onSaved={({ message, expiresAt }) => {
              setQuickControlsOpen(false);
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
                data-tour-id={TOUR_TARGET_IDS.HOME_STATUS}
                className="focus-ring safe-motion flex min-h-[60px] w-full items-center gap-3.5 px-4 py-3 text-left transition-colors hover:bg-secondary/40"
              >
                <MessageSquareText className="h-5 w-5 shrink-0 text-muted-foreground" strokeWidth={1.75} aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block text-[0.9375rem] font-medium">Current Status</span>
                  <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                    {hasActiveStatus ? statusDisplay(initialStatusNote, initialStatusAvailability) : "Set a status"}
                  </span>
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              </button>
            }
          />
        }
      />

      <HomeSettingsSheet
        open={settingsSheetOpen}
        onOpenChange={setSettingsSheetOpen}
        displayName={displayName}
        currentUsername={currentUsername}
        currentAvatarUrl={currentAvatarUrl}
        subscriptionPlan={subscriptionPlan}
        buddyScoreLevelLabel={buddyScoreLevelLabel}
        // Same three-item model the profile reminder uses (photo, bio, mood):
        // profileReminder is null once nothing is missing, so no reminder
        // means a complete profile.
        profileCompletionPercent={
          profileReminder
            ? Math.round(((3 - profileReminder.missingItems.length) / 3) * 100)
            : 100
        }
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Nearby hero — at most four positions, fixed height at any nearby count.
// ---------------------------------------------------------------------------

function NearbyHero({
  friends,
  total,
  ghostMode,
  isFirstTimeUser,
  glowColorByFriendId,
  reducedMotion,
  onSelect
}: {
  friends: DashboardFriend[];
  total: number;
  ghostMode: boolean;
  isFirstTimeUser: boolean;
  glowColorByFriendId: Record<string, string>;
  reducedMotion: boolean;
  onSelect: (friendId: string) => void;
}) {
  // Over the cap, keep the three strongest and give the 4th slot to "+N".
  const overflow = total > NEARBY_MAX_POSITIONS;
  const shown = overflow ? friends.slice(0, NEARBY_MAX_POSITIONS - 1) : friends.slice(0, NEARBY_MAX_POSITIONS);
  const remaining = total - shown.length;

  return (
    // data-tour-id is the guided tour's stable targeting contract; the tour
    // spotlights this real section rather than showing a screenshot of it.
    <section aria-labelledby="home-nearby-heading" data-tour-id={TOUR_TARGET_IDS.HOME_NEARBY}>
      <div className="mb-3 flex items-center justify-between">
        <h2 id="home-nearby-heading" className="text-base font-semibold tracking-tight">
          Nearby right now
        </h2>
        {total > 0 ? (
          <Link
            href="/friends"
            className="inline-flex items-center gap-0.5 text-sm font-medium text-primary hover:underline"
            aria-label={`${total} nearby, view all Muddies`}
          >
            View all
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        ) : null}
      </div>

      {total > 0 ? (
        // One fixed row of up to four positions — never wraps, never grows with
        // the nearby count. Larger avatars read as the hero; the top/side
        // padding keeps the animated halo from being clipped at the row's edge.
        // A glass-panel wrapper matches the Journey hero and empty-state card
        // below so Nearby reads as one connected surface, not a bare row.
        <div
          className="glass-panel -mx-1 flex items-start justify-between gap-1 rounded-[1.5rem] px-4 py-5 sm:gap-3"
          aria-label="Nearby Muddies"
        >
          {shown.map((friend) => {
            const name = friend.displayName || friend.username;
            return (
              <button
                key={friend.friendId}
                type="button"
                onClick={() => onSelect(friend.friendId)}
                className="focus-ring safe-motion flex min-w-0 basis-0 grow flex-col items-center gap-2 text-center"
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
                    // Identity, independent of the proximity props above:
                    // GlowRing owns the distance aura, UserAvatar owns the
                    // membership band. Neither reads the other's inputs.
                    membershipTier={friend.membershipTier}
                    size="lg"
                    reducedMotion={reducedMotion}
                  />
                  {/* Presence: a nearby Muddy with a live, just-updated signal. */}
                  {friend.freshnessState === "live" ? (
                    <span
                      className="absolute bottom-0.5 right-0.5 z-[2] h-3.5 w-3.5 rounded-full border-2 border-background bg-emerald-500"
                      aria-hidden="true"
                    />
                  ) : null}
                </span>
                <span className="w-full truncate text-xs font-medium">{capitalize(name)}</span>
                <span
                  className={cn(
                    "inline-flex max-w-full items-center truncate rounded-full px-2 py-0.5 text-[10px] font-semibold",
                    PROXIMITY_LABEL_CLASS[friend.proximityLevel] ?? "bg-primary/12 text-primary"
                  )}
                >
                  {proximityLabels[friend.proximityLevel]}
                </span>
              </button>
            );
          })}

          {overflow ? (
            <Link
              href="/friends"
              className="focus-ring safe-motion flex min-w-0 basis-0 grow flex-col items-center gap-2 text-center"
              aria-label={`View all ${total} nearby Muddies`}
            >
              <span className="grid h-16 w-16 place-items-center rounded-full border-2 border-dashed border-border bg-secondary/40 leading-none">
                <span className="text-sm font-bold">+{remaining}</span>
                <span className="mt-0.5 text-[8px] font-medium text-muted-foreground">Muddies</span>
              </span>
              <span className="w-full truncate text-xs font-medium text-transparent">.</span>
              <span className="text-[10px] font-semibold text-primary">View all</span>
            </Link>
          ) : null}
        </div>
      ) : (
        // Polished empty-state card — a friendly illustration, copy, and a
        // single primary action. No coloured panel, no reused profile avatar.
        <div className="glass-panel flex flex-col items-center rounded-[1.5rem] px-6 py-8 text-center">
          <span className="relative grid h-20 w-20 place-items-center" aria-hidden="true">
            {/* Concentric proximity rings — the same idea as the glow, resting —
                the illustration for "nobody nearby yet", not a person. */}
            <span className="absolute inset-0 rounded-full border border-border/60" />
            <span className="absolute inset-[13px] rounded-full border border-border/45" />
            <span className="grid h-10 w-10 place-items-center rounded-full bg-secondary/70 text-muted-foreground">
              {ghostMode ? <Ghost className="h-5 w-5" aria-hidden="true" /> : <Users className="h-5 w-5" aria-hidden="true" />}
            </span>
          </span>
          <p className="mt-4 text-[0.95rem] font-semibold">
            {ghostMode ? "Visibility is paused" : isFirstTimeUser ? "No Muddies nearby yet" : "No Muddies nearby"}
          </p>
          <p className="mt-1.5 max-w-[19rem] text-sm leading-6 text-muted-foreground">
            {ghostMode
              ? "Turn visibility back on to appear nearby."
              : "Invite trusted friends to start building your circle."}
          </p>
          {!ghostMode ? (
            <Link
              href="/friends?tab=add"
              className="focus-ring safe-motion mt-4 inline-flex h-10 items-center gap-1.5 rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-[0_4px_14px_hsl(var(--shadow)/0.16)] transition-transform active:scale-[0.97] motion-reduce:active:scale-100"
            >
              <UserPlus className="h-4 w-4" aria-hidden="true" />
              {isFirstTimeUser ? "Add your first Muddy" : "Invite your first Muddy"}
            </Link>
          ) : null}
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// First-time quick actions — activation-focused, fixed set of four.
// ---------------------------------------------------------------------------

type FirstTimeAction = { href: Route; label: string; icon: LucideIcon };

const FIRST_TIME_ACTIONS: FirstTimeAction[] = [
  { href: "/friends?tab=add", label: "Add Muddy", icon: UserPlus },
  { href: "/plans?create=1", label: "Create Plan", icon: CalendarPlus },
  { href: "/moments", label: "Share Moment", icon: Sparkles },
  { href: "/help", label: "Learn Mad Buddy", icon: GraduationCap }
];

function FirstTimeQuickActions() {
  return (
    <section aria-labelledby="home-actions-heading" data-tour-id={TOUR_TARGET_IDS.HOME_QUICK_ACTIONS}>
      <h2 id="home-actions-heading" className="mb-3 text-sm font-semibold">
        Quick actions
      </h2>
      <div className="grid grid-cols-4 gap-2.5">
        {FIRST_TIME_ACTIONS.map((action) => (
          <Link
            key={action.href}
            href={action.href}
            aria-label={action.label}
            title={action.label}
            className="focus-ring safe-motion glass-panel flex min-h-[92px] w-full flex-col items-center justify-center gap-2 rounded-[1.25rem] px-1 py-3 text-center transition-transform active:scale-[0.97] motion-reduce:active:scale-100"
          >
            <action.icon className="h-7 w-7 shrink-0 text-foreground/70" strokeWidth={1.5} aria-hidden="true" />
            <span className="line-clamp-2 w-full text-xs font-medium leading-tight">{action.label}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Quick actions — three primary + a More sheet for the rest.
// ---------------------------------------------------------------------------

type QuickAction = {
  href: Route;
  label: string;
  description: string;
  icon: LucideIcon;
  featureIcon: FeatureIconKey;
  /** Per-feature accent (the FeatureIcon glyph is a currentColor mask). */
  accent: string;
};

const quickActions: QuickAction[] = [
  { href: "/hangout-mode", label: "Hangout", description: "Let your Muddies know you’re open to meeting.", icon: Hand, featureIcon: "hangout", accent: "text-primary" },
  { href: "/discover", label: "Socialize", description: "Find people who are open to socializing.", icon: Compass, featureIcon: "socialize", accent: "text-violet-500 dark:text-violet-400" },
  { href: "/safe-arrival", label: "Safe Arrival", description: "Let trusted Muddies know when you arrive safely.", icon: ShieldCheck, featureIcon: "safeArrival", accent: "text-sky-500 dark:text-sky-400" },
  { href: "/moments", label: "Moments", description: "Share a moment before it disappears.", icon: Sparkles, featureIcon: "moments", accent: "text-primary" },
  { href: "/events", label: "Events", description: "See what’s coming up.", icon: PartyPopper, featureIcon: "events", accent: "text-violet-500 dark:text-violet-400" },
  { href: "/groups", label: "Groups", description: "Open your groups and invitations.", icon: Users2, featureIcon: "groups", accent: "text-sky-500 dark:text-sky-400" },
  { href: "/invites", label: "Invites", description: "Review and send invitations.", icon: UserPlus, featureIcon: "invites", accent: "text-emerald-500 dark:text-emerald-400" },
  { href: "/reminders", label: "Reminders", description: "Reminders for plans and connections.", icon: Bell, featureIcon: "reminders", accent: "text-amber-500 dark:text-amber-400" },
  { href: "/settings/engagement", label: "Focus", description: "Manage Focus Mode and notification limits.", icon: Moon, featureIcon: "focus", accent: "text-pink-500 dark:text-pink-400" }
];

const PRIMARY_ACTION_HREFS = ["/hangout-mode", "/discover", "/safe-arrival"];

/**
 * Splits the flag-filtered actions into the three primary tiles and the rest
 * ("More"). Shared by the launcher row and the bottom gap-filler so a promoted
 * action is never shown twice.
 */
function splitQuickActions(hiddenHrefs: string[]): { primary: QuickAction[]; secondary: QuickAction[] } {
  const available = quickActions.filter((action) => !hiddenHrefs.includes(action.href));
  // Keep three primary tiles. If one (e.g. Socialize) is disabled by Owner
  // controls, backfill from the remaining actions so there is never an empty
  // gap where a feature used to be.
  const primary: QuickAction[] = available.filter((action) => PRIMARY_ACTION_HREFS.includes(action.href));
  const rest = available.filter((action) => !PRIMARY_ACTION_HREFS.includes(action.href));
  while (primary.length < 3 && rest.length > 0) {
    primary.push(rest.shift()!);
  }
  return { primary, secondary: rest };
}

function QuickActionsHome({
  primary,
  secondary
}: {
  primary: QuickAction[];
  secondary: QuickAction[];
}) {
  const [moreOpen, setMoreOpen] = useState(false);

  return (
    <section aria-labelledby="home-actions-heading" data-tour-id={TOUR_TARGET_IDS.HOME_QUICK_ACTIONS}>
      <h2 id="home-actions-heading" className="mb-3 text-sm font-semibold">
        Quick actions
      </h2>
      {/* Premium rounded cards — a soft glass surface per tile rather than a
          bare icon-on-background cell, with a larger glyph as the focal point. */}
      <div className={cn("grid gap-2.5", secondary.length > 0 ? "grid-cols-4" : "grid-cols-3")}>
        {primary.map((action) => (
          <QuickActionTile key={action.href} action={action} />
        ))}
        {secondary.length > 0 ? (
          <button
            type="button"
            onClick={() => setMoreOpen(true)}
            className="focus-ring safe-motion glass-panel flex min-h-[92px] flex-col items-center justify-center gap-2 rounded-[1.25rem] px-1 py-3 text-center transition-transform active:scale-[0.97] motion-reduce:active:scale-100"
            aria-label="More quick actions"
          >
            <LayoutGrid className="h-8 w-8 shrink-0 text-muted-foreground" strokeWidth={1.5} aria-hidden="true" />
            <span className="line-clamp-2 w-full text-xs font-medium leading-tight">More</span>
          </button>
        ) : null}
      </div>

      <Modal
        open={moreOpen}
        onOpenChange={setMoreOpen}
        title="More actions"
        description="Jump to another Mad Buddy feature."
        variant="sheet"
      >
        {/* Same premium card language as the launcher row above. */}
        <div className="grid grid-cols-3 gap-2.5 pt-1 sm:grid-cols-4">
          {secondary.map((action) => (
            <Link
              key={action.href}
              href={action.href}
              onClick={() => setMoreOpen(false)}
              aria-label={action.description}
              className="focus-ring safe-motion glass-panel flex min-h-[92px] flex-col items-center justify-center gap-2 rounded-[1.25rem] px-1 py-3 text-center transition-transform active:scale-[0.97] motion-reduce:active:scale-100"
            >
              <FeatureIcon feature={action.featureIcon} size={30} decorative className={action.accent} />
              <span className="line-clamp-2 w-full text-xs font-medium leading-tight">{action.label}</span>
            </Link>
          ))}
        </div>
      </Modal>
    </section>
  );
}

function QuickActionTile({ action }: { action: QuickAction }) {
  return (
    <Link
      href={action.href}
      aria-label={action.description}
      title={action.description}
      className="focus-ring safe-motion glass-panel flex min-h-[92px] w-full flex-col items-center justify-center gap-2 rounded-[1.25rem] px-1 py-3 text-center transition-transform active:scale-[0.97] motion-reduce:active:scale-100"
    >
      <FeatureIcon feature={action.featureIcon} size={32} decorative className={action.accent} />
      {/* Two-line label wraps ("Safe Arrival") rather than truncating; never
          forces horizontal scroll because it only ever wraps within the cell. */}
      <span className="line-clamp-2 w-full text-xs font-medium leading-tight">{action.label}</span>
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Bottom gap filler — turns leftover space into useful shortcuts.
// ---------------------------------------------------------------------------

/** One tile row (min-h 92px) plus the grid gap. */
const FILLER_ROW_HEIGHT = 102;
/** Section heading + its margin. */
const FILLER_HEADING = 30;
/** Never push past two extra rows — this fills space, it doesn't become a hub. */
const FILLER_MAX_ROWS = 2;
const FILLER_PER_ROW = 4;

/**
 * Measures the space left between where it sits and the bottom navigation, and
 * fills it with as many extra quick actions as cleanly fit. When real content
 * (an upcoming plan, Safe Arrival, more nearby Muddies…) grows into that space,
 * the count drops and those actions retract back into "More" — the parent
 * excludes whatever is promoted here, so nothing is ever listed twice.
 *
 * The measurement uses this element's own document offset, which does NOT
 * depend on how many tiles it renders, so growing the filler can't feed back
 * into the measurement and oscillate.
 */
function HomeGapFillerActions({
  pool,
  onPromotedChange
}: {
  pool: QuickAction[];
  onPromotedChange: (count: number) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [rows, setRows] = useState(0);

  useEffect(() => {
    const element = containerRef.current;
    if (!element || pool.length === 0) {
      setRows(0);
      return;
    }

    let frame = 0;
    const measure = () => {
      // The real bottom bar (mobile only) already includes its safe-area pad.
      const nav = document.querySelector('nav[aria-label="Mobile navigation"]');
      const navHeight = nav ? nav.getBoundingClientRect().height : 0;
      const topInDocument = element.getBoundingClientRect().top + window.scrollY;
      const firstScreenBottom = window.innerHeight - navHeight - 12;
      const gap = firstScreenBottom - topInDocument;
      const fit = Math.floor((gap - FILLER_HEADING) / FILLER_ROW_HEIGHT);
      const maxRows = Math.min(FILLER_MAX_ROWS, Math.ceil(pool.length / FILLER_PER_ROW));
      setRows(Math.max(0, Math.min(maxRows, fit)));
    };
    const schedule = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(measure);
    };

    schedule();
    // Re-measure when the column's content height changes (a plan arrives, a
    // banner is dismissed, Muddies load) or the viewport changes.
    const observer = new ResizeObserver(schedule);
    if (element.parentElement) observer.observe(element.parentElement);
    window.addEventListener("resize", schedule);
    window.addEventListener("orientationchange", schedule);
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", schedule);
      window.removeEventListener("orientationchange", schedule);
    };
  }, [pool.length]);

  const shown = useMemo(() => pool.slice(0, rows * FILLER_PER_ROW), [pool, rows]);

  useEffect(() => {
    onPromotedChange(shown.length);
  }, [shown.length, onPromotedChange]);

  return (
    <div ref={containerRef}>
      {shown.length > 0 ? (
        <section aria-labelledby="home-more-actions-heading">
          <h2 id="home-more-actions-heading" className="mb-3 text-sm font-semibold text-muted-foreground">
            More to explore
          </h2>
          <div className="grid grid-cols-4 gap-2.5">
            {shown.map((action) => (
              <QuickActionTile key={action.href} action={action} />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Upcoming plan — one compact tappable row.
// ---------------------------------------------------------------------------

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
    <section aria-labelledby="home-plan-heading" data-tour-id={TOUR_TARGET_IDS.HOME_UPCOMING_PLAN}>
      <div className="mb-3 flex items-center justify-between">
        <h2 id="home-plan-heading" className="text-sm font-semibold">
          Upcoming
        </h2>
        <Link href="/plans" className="text-xs font-medium text-primary hover:underline">
          All plans
        </Link>
      </div>
      {/* A compact preview, not a full plan card — the whole row is tappable and
          the complete detail lives on /plans. */}
      <Link
        href="/plans"
        aria-label={`${capitalize(plan.title)}, ${when}, ${rsvpLabel(plan.myRsvp)}`}
        className="focus-ring safe-motion glass-panel flex items-center gap-3 rounded-[1.5rem] px-5 py-4 transition-colors hover:bg-secondary/20"
      >
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
          <CalendarDays className="h-[18px] w-[18px]" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{capitalize(plan.title)}</p>
          {/* Date + place on one truncating line — the whole line ellipsises as
              a unit, so it can't overflow or wrap on the narrowest phones. */}
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Greeting subtitle.
 *
 * This deliberately does NOT describe Journey progress any more. The Smart
 * Card directly below is the canonical place where "what should I do next"
 * is answered, and it says so in a full title, subtitle and CTA. When this
 * line was also Journey-derived the two restated each other — the greeting
 * said "one step from Trusted Buddy" immediately above a card whose title was
 * that very step.
 *
 * So the greeting now carries orientation the card never does — who and when
 * — and leaves the "what next" entirely to the card. The two complement
 * rather than compete, whichever of the ten cards is showing.
 */
function greetingSubtitle(name: string | null, now: Date): string {
  const hour = now.getHours();
  const partOfDay = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  return name ? `${partOfDay}, ${name}.` : `${partOfDay}.`;
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
    // Server-resolved; never derived from the boolean above.
    membershipTier: friend.membership_tier ?? "free",
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
      aria-label="Membership"
      title="Membership"
      data-subscription-status={label}
      className="focus-ring grid h-11 w-11 place-items-center rounded-xl text-muted-foreground hover:bg-secondary hover:text-foreground dark:hover:bg-white/[0.05]"
    >
      <CircleDollarSign className="h-5 w-5" aria-hidden="true" />
    </Link>,
    target
  );
}
