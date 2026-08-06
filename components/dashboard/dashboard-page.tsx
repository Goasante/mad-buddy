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
  Clock,
  Compass,
  Ghost,
  GraduationCap,
  Hand,
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
import type { CSSProperties } from "react";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { createMeetupRequestAction } from "@/app/(app)/premium-actions";
import { updateVisibilityStatusAction } from "@/app/(app)/settings-actions";
import { MobilePageHeader } from "@/components/app-shell/mobile-page-header";
import { PlanCover } from "@/components/plans/plan-cover";
import { MomentsPreview } from "@/components/content/moments-preview";
import { PageSectionHeader } from "@/components/app-shell/page-section-header";
import type { VisibleMoment } from "@/lib/content/service";
import { useUnreadNotifications } from "@/hooks/unread-notification-context";
import { usePullRefreshListener } from "@/components/ui/pull-to-refresh";
import { appCache, cacheKeys } from "@/lib/cache/entity-cache";
import type { PublicMembershipTier } from "@/lib/billing/premium-identity";
import { useAppMenu } from "@/hooks/app-menu-context";
import { useInteractionPause, useSequenceHighlight } from "@/hooks/use-sequence-highlight";
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
   * A capped slice of the canonical Moments feed, already authorised by
   * buildMomentFeed. Home previews it; /moments owns the real experience.
   */
  moments?: VisibleMoment[];
  /** Live Air sessions, mixed into the same rail as Moments. */
  air?: VisibleMoment[];
  /**
   * Canonical first-time signal, computed server-side from real Journey
   * progress (see app/(app)/dashboard/page.tsx) — never inferred client-side.
   * Swaps the Quick Actions set and the Nearby empty-state copy/CTA to the
   * activation-focused variant; everything else on Home behaves identically.
   */
  isFirstTimeUser?: boolean;
  // currentUsername / currentAvatarUrl / buddyScoreLevelLabel used to be
  // passed here for Home's own copy of the menu sheet. That sheet now lives
  // in AppShell and gets its identity from the layout, so Home no longer
  // needs them.
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

/**
 * Positions rendered in the Near row before the rest collapse into a "+N"
 * tile. The row scrolls horizontally, so this is no longer bounded by what
 * fits on screen (~5 at 390px) — it caps how much Home renders and keeps
 * "See all" meaningful for a large circle.
 */
const NEARBY_MAX_POSITIONS = 8;

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
/**
 * Dot colours for the Near section's distance label. Theme tokens and Tailwind
 * palette steps that already have dark-mode variants — no hardcoded hex.
 */
const PROXIMITY_DOT_CLASS: Partial<Record<ProximityLevel, string>> = {
  close: "bg-emerald-500",
  near: "bg-[var(--color-brand-orange)]",
  far: "bg-violet-500"
};

/**
 * Presentation-only multiplier on the Near section's proximity aura.
 *
 * The glow should communicate distance quietly rather than dominate the row,
 * and a tighter aura is also what keeps neighbouring avatars from visually
 * colliding. Applied in GlowRing (not CSS) because the opacity values are set
 * as inline custom properties, which a stylesheet rule cannot override.
 */
const NEAR_GLOW_INTENSITY = 0.72;

/**
 * One optical size and colour for the plan card's three leading icons, so the
 * what/when/where rail reads as a single system.
 */
const PLAN_ICON = "h-4 w-4 shrink-0 text-muted-foreground";

/** First name only, for the Near row's one-line labels. */
function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
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
  glowColorByFriendId = {},
  profileReminder = null,
  safeArrival = null,
  hiddenQuickActionHrefs = [],
  smartCard = null,
  moments = [],
  air = [],
  isFirstTimeUser = false,
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
  const [quickControlsOpen, setQuickControlsOpen] = useState(false);
  // The app-wide menu sheet lives in AppShell; Home just asks it to open.
  const openAppMenu = useAppMenu();
  // The shell's canonical unread count, read from context — not a second
  // counter, not another poller, and not derived from anything on this page.
  const unreadNotificationCount = useUnreadNotifications();
  const [isPending, startTransition] = useTransition();
  // Nearby is fetched client-side after mount, so there is a real window with
  // no data yet. Distinguishes "still loading" from "genuinely nobody nearby".
  const [nearbyLoaded, setNearbyLoaded] = useState(false);
  const locationUpdateInFlightRef = useRef(false);
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

  /**
   * Near — the ONE Home section that loads on the client.
   *
   * Everything else on Home (Smart Card, Plans, Suggestions, Moments preview)
   * is awaited in the server component and arrives as props, so there is no
   * client fetch to put a cache in front of. This is the section that has one.
   *
   * Routed through the canonical EntityCache, which replaces the hand-rolled
   * in-flight ref this used to keep: deduplication, stale-while-revalidate and
   * authorisation-scoped invalidation now come from one shared implementation
   * rather than being reimplemented here.
   *
   * The cache is an optimisation, never truth: a cached rail renders straight
   * away, the request still goes out, and the server's answer replaces it.
   */
  const loadNearbyFriends = useCallback(() => {
    const key = cacheKeys.homeNearby();

    const request = appCache.read<NearbyFriendApiItem[]>(
      key,
      async () => {
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
          throw new Error(error.error ?? "Could not refresh nearby friends.");
        }

        const data = (await response.json()) as { friends: NearbyFriendApiItem[] };
        return data.friends;
      },
      // Short windows: a nearby rail that is minutes old should not be
      // presented as current.
      { staleAfterMs: 30_000, expiresAfterMs: 3 * 60_000 }
    );

    const settled = request
      .then((friends: NearbyFriendApiItem[]) => {
        setFriends(friends.map(toDashboardFriend));
        setStatusMessage("");
      })
      .catch((error: unknown) => {
        // A failed refresh leaves whatever is already rendered in place —
        // Home is never blanked by a network problem. No raw error surfaces.
        setStatusMessage(
          error instanceof Error && error.message ? error.message : "Could not reach the nearby friends service."
        );
      })
      .finally(() => {
        // First load has settled (either way) — the skeleton gives way to
        // real data or to the empty state. Never shown again on refresh, so
        // a pull-to-refresh cannot blank the row the user is looking at.
        setNearbyLoaded(true);
      });

    startTransition(async () => settled);
    return settled;
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
        // The app-wide sheet, mounted once in AppShell — Home no longer keeps
        // its own copy.
        onOpenMenu={openAppMenu}
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
          The header is FIXED, so its own padding no longer contributes to the
          gap below it — <main> reserves the height and this supplies the
          breathing room between the header rule and the greeting. */}
      <div className="mx-auto w-full max-w-[560px] space-y-5 pt-4">
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
          glowColorByFriendId={glowColorByFriendId}
          reducedMotion={reducedMotion}
          loaded={nearbyLoaded}
          onSelect={setSelectedFriendId}
        />

        {/* Upcoming Plans sits directly under Near: both answer "what is
            happening with my people", so they belong together, above the
            generic action shortcuts. */}
        {plan ? <UpcomingPlanRow plan={plan} /> : <UpcomingPlanEmpty />}

        {/* Quick actions: first-time activation set, or the returning-user set. */}
        {isFirstTimeUser ? (
          <FirstTimeQuickActions />
        ) : (
          <QuickActionsHome primary={primaryActions} secondary={moreActions} />
        )}

        {/* Moments preview. Renders the branded onboarding when the viewer has
            none, and the rail once any exist — so the onboarding is never
            shown again after a first Moment. */}
        <MomentsPreview moments={moments} air={air} />

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
  glowColorByFriendId,
  reducedMotion,
  loaded = true,
  onSelect
}: {
  friends: DashboardFriend[];
  total: number;
  ghostMode: boolean;
  glowColorByFriendId: Record<string, string>;
  reducedMotion: boolean;
  /** False until the first nearby fetch settles; drives the skeleton. */
  loaded?: boolean;
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
      {/* Generous space above and below: this is the signature section, and
          the air around it is what stops it reading as a contact list. */}
      <PageSectionHeader
        id="home-nearby-heading"
        title="Near"
        href={total > 0 ? "/friends" : undefined}
        actionAriaLabel={`See all ${total} nearby Muddies`}
      />

      {!loaded && total === 0 ? (
        // Lightweight skeletons matching the real column footprint exactly, so
        // the row does not resize when data arrives. No large loading card.
        // gap-4 matches the real rail below: a different gap here would shift
        // every avatar sideways the moment data arrives.
        <div className="near-strip -mx-4 flex items-start gap-4 overflow-hidden px-4 py-2 sm:-mx-6 sm:px-6" aria-hidden="true">
          {[0, 1, 2, 3, 4].map((index) => (
            <div key={index} className="flex w-[4.75rem] shrink-0 flex-col items-center gap-2.5">
              <span className="h-16 w-16 animate-pulse rounded-full bg-secondary/70 motion-reduce:animate-none" />
              <span className="h-3 w-12 animate-pulse rounded bg-secondary/70 motion-reduce:animate-none" />
              <span className="h-2.5 w-9 animate-pulse rounded bg-secondary/50 motion-reduce:animate-none" />
            </div>
          ))}
        </div>
      ) : total > 0 ? (
        // A bare horizontal rail, not a panel — the avatars themselves are the
        // surface. Scrolls naturally with no snapping and no indicators.
        //
        // The negative margin + matching padding let the row bleed to the
        // screen edges (so the last avatar scrolls fully into view) while the
        // first avatar still aligns with the page's content column. The
        // vertical padding gives the glow room so it is never clipped by the
        // scroll container.
        <div
          className="near-strip -mx-4 flex items-start gap-4 overflow-x-auto px-4 py-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:-mx-6 sm:px-6"
          aria-label="Nearby Muddies"
        >
          {shown.map((friend) => {
            const name = friend.displayName || friend.username;
            return (
              <button
                key={friend.friendId}
                type="button"
                onClick={() => onSelect(friend.friendId)}
                // Fixed width so every column is identical and the distance
                // labels line up across the row regardless of name length.
                // shrink-0 is what keeps the row from wrapping or squashing.
                className="focus-ring safe-motion group flex w-[4.75rem] shrink-0 flex-col items-center gap-2.5 text-center transition-transform active:scale-[0.98] motion-reduce:active:scale-100"
                aria-label={`${capitalize(firstName(name))}, ${proximityLabels[friend.proximityLevel]}`}
              >
                {/* Fixed-height avatar slot. The halo's padding varies with
                    proximity, so without a fixed box each column would be a
                    slightly different height and the names and distance labels
                    would sit at different baselines across the row. */}
                <span className="relative grid h-[4.5rem] w-full place-items-center">
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
                    size="near"
                    reducedMotion={reducedMotion}
                    // Presentation only: a calmer aura on Home. Proximity,
                    // strength and confidence are untouched, so the
                    // close/near/far ordering is preserved.
                    intensity={NEAR_GLOW_INTENSITY}
                  />
                  {/* Presence: a nearby Muddy with a live, just-updated signal.
                      Anchored to the centred 64px avatar box rather than the
                      fixed-height slot, so it sits on the avatar's edge at
                      every proximity level. */}
                  {friend.freshnessState === "live" ? (
                    <span
                      className="pointer-events-none absolute left-1/2 top-1/2 h-16 w-16 -translate-x-1/2 -translate-y-1/2"
                      aria-hidden="true"
                    >
                      <span className="absolute bottom-0 right-0 z-[2] h-3 w-3 rounded-full border-2 border-background bg-emerald-500" />
                    </span>
                  ) : null}
                </span>
                {/* First name only, one line — a surname would force either a
                    second line or an ellipsis on almost every entry. */}
                <span className="w-full truncate text-sm font-semibold leading-none">
                  {capitalize(firstName(name))}
                </span>
                {/* The glow already carries proximity; this quietly confirms
                    it. A dot plus muted text, never a coloured pill. */}
                <span className="inline-flex max-w-full items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  <span
                    className={cn(
                      "h-1.5 w-1.5 shrink-0 rounded-full",
                      PROXIMITY_DOT_CLASS[friend.proximityLevel] ?? "bg-muted-foreground"
                    )}
                    aria-hidden="true"
                  />
                  <span className="truncate">{proximityLabels[friend.proximityLevel]}</span>
                </span>
              </button>
            );
          })}

          {overflow ? (
            <Link
              href="/friends"
              className="focus-ring safe-motion flex w-[4.75rem] shrink-0 flex-col items-center gap-2.5 text-center transition-transform active:scale-[0.98] motion-reduce:active:scale-100"
              aria-label={`See all ${total} nearby Muddies`}
            >
              {/* Matches the avatar's footprint exactly so the row's baseline
                  and label alignment hold. */}
              <span className="grid h-16 w-16 place-items-center rounded-full border border-dashed border-border bg-secondary/40 text-sm font-semibold">
                +{remaining}
              </span>
              <span className="w-full truncate text-sm font-semibold leading-none text-muted-foreground">
                More
              </span>
              <span className="text-xs font-medium text-[var(--color-brand-orange)]">See all</span>
            </Link>
          ) : null}
        </div>
      ) : (
        // Lightweight empty state — no card, no large placeholder. Reuses the
        // existing concentric-rings mark (the resting form of the glow) at a
        // small size, so the section stays quiet when nobody is around rather
        // than drawing attention to its own emptiness.
        <div className="flex items-center gap-3.5 py-1">
          <span className="relative grid h-11 w-11 shrink-0 place-items-center" aria-hidden="true">
            <span className="absolute inset-0 rounded-full border border-border/60" />
            <span className="grid h-7 w-7 place-items-center rounded-full bg-secondary/70 text-muted-foreground">
              {ghostMode ? <Ghost className="h-4 w-4" aria-hidden="true" /> : <Users className="h-4 w-4" aria-hidden="true" />}
            </span>
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold">
              {ghostMode ? "Visibility is paused" : "No trusted Muddies nearby."}
            </p>
            <p className="mt-0.5 text-[0.8125rem] leading-5 text-muted-foreground">
              {ghostMode ? (
                "Turn visibility back on to appear nearby."
              ) : (
                <>
                  <Link
                    href="/friends?tab=add"
                    className="focus-ring rounded font-medium text-[var(--color-brand-orange)] hover:underline"
                  >
                    Invite friends
                  </Link>{" "}
                  or turn on your Glow.
                </>
              )}
            </p>
          </div>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// First-time quick actions — activation-focused, fixed set of four.
// ---------------------------------------------------------------------------

/**
 * The activation-focused suggestion set for brand-new accounts. Same card
 * language as the returning-user rail, so the two never look like different
 * systems — only the recommendations differ.
 */
const FIRST_TIME_ACTIONS: QuickAction[] = [
  { href: "/friends?tab=add", label: "Add a Muddy", description: "Find people you already know.", suggestion: "Start building your circle.", tone: "lavender", icon: UserPlus, featureIcon: "invites", accent: "text-violet-500 dark:text-violet-400" },
  { href: "/plans?create=1", label: "Create a Plan", description: "Create a plan and bring people together.", suggestion: "Bring people together.", tone: "green", icon: CalendarPlus, featureIcon: "plans", accent: "text-emerald-500 dark:text-emerald-400" },
  { href: "/moments", label: "Share a Moment", description: "Share a moment before it disappears.", suggestion: "Share something before it’s gone.", tone: "blush", icon: Sparkles, featureIcon: "moments", accent: "text-primary" },
  { href: "/help", label: "Learn Mad Buddy", description: "See how Mad Buddy works.", suggestion: "See how everything works.", tone: "blue", icon: GraduationCap, featureIcon: "focus", accent: "text-sky-500 dark:text-sky-400" }
];

function FirstTimeQuickActions() {
  return (
    <section aria-labelledby="home-actions-heading" data-tour-id={TOUR_TARGET_IDS.HOME_QUICK_ACTIONS}>
      {/* No action: the first-time set is the whole set, so there is nothing
          more to see. */}
      <PageSectionHeader id="home-actions-heading" title="Suggestions for you" />
      <div className="-mx-4 flex gap-2.5 overflow-x-auto px-4 pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:-mx-6 sm:px-6">
        {FIRST_TIME_ACTIONS.map((action) => (
          <SuggestionCard key={action.href} action={action} />
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
  /** Suggestion-card palette key. See SUGGESTION_TONE. */
  tone: SuggestionTone;
  /** Short recommendation copy for the suggestion card. */
  suggestion: string;
};

/**
 * The suggestion card palettes.
 *
 * Deliberately soft: a low-alpha wash rather than a saturated fill, so the
 * rail reads as calm at a glance and every tone works on both themes without
 * a second set of values. Dark mode leans on the same alpha over a dark
 * surface, which desaturates naturally instead of glowing.
 */
type SuggestionTone = "orange" | "lavender" | "green" | "blue" | "blush";

const SUGGESTION_TONE: Record<
  SuggestionTone,
  { surface: string; icon: string; edge: { a: string; b: string } }
> = {
  orange: {
    surface: "bg-orange-500/[0.09] dark:bg-orange-400/[0.12]",
    icon: "bg-orange-500/15 text-orange-600 dark:bg-orange-400/20 dark:text-orange-300",
    // orange-500 -> coral. Each card sweeps in its OWN family, never a shared
    // rainbow, so the border reads as part of the card rather than an effect
    // applied on top of it.
    edge: { a: "249 115 22", b: "251 113 133" }
  },
  lavender: {
    surface: "bg-violet-500/[0.09] dark:bg-violet-400/[0.12]",
    icon: "bg-violet-500/15 text-violet-600 dark:bg-violet-400/20 dark:text-violet-300",
    // violet-500 -> indigo-500
    edge: { a: "139 92 246", b: "99 102 241" }
  },
  green: {
    surface: "bg-emerald-500/[0.09] dark:bg-emerald-400/[0.12]",
    icon: "bg-emerald-500/15 text-emerald-600 dark:bg-emerald-400/20 dark:text-emerald-300",
    // emerald-500 -> mint
    edge: { a: "16 185 129", b: "52 211 153" }
  },
  blue: {
    surface: "bg-sky-500/[0.09] dark:bg-sky-400/[0.12]",
    icon: "bg-sky-500/15 text-sky-600 dark:bg-sky-400/20 dark:text-sky-300",
    // sky-500 -> cyan-400
    edge: { a: "14 165 233", b: "34 211 238" }
  },
  blush: {
    surface: "bg-pink-500/[0.09] dark:bg-pink-400/[0.12]",
    icon: "bg-pink-500/15 text-pink-600 dark:bg-pink-400/20 dark:text-pink-300",
    // pink-500 -> rose-400
    edge: { a: "236 72 153", b: "251 113 133" }
  }
};

/**
 * The canonical Home action set — now also the suggestion source.
 *
 * `label`/`description` still drive the "More to explore" tiles and the More
 * sheet; `suggestion` is the shorter, recommendation-shaped copy the cards
 * use ("Find spontaneous meetups." rather than a feature description).
 *
 * Every entry points at a route that already exists, and the list is still
 * filtered by the same Owner feature flags — no new recommendation logic.
 */
const quickActions: QuickAction[] = [
  { href: "/hangout-mode", label: "Join a Hangout", description: "Let your Muddies know you’re open to meeting.", suggestion: "Find spontaneous meetups.", tone: "orange", icon: Hand, featureIcon: "hangout", accent: "text-primary" },
  { href: "/invites", label: "Invite Friends", description: "Review and send invitations.", suggestion: "Grow your trusted circle.", tone: "lavender", icon: UserPlus, featureIcon: "invites", accent: "text-emerald-500 dark:text-emerald-400" },
  { href: "/plans?create=1", label: "Complete a Plan", description: "Create a plan and bring people together.", suggestion: "Bring people together.", tone: "green", icon: CalendarDays, featureIcon: "plans", accent: "text-emerald-500 dark:text-emerald-400" },
  { href: "/events", label: "Discover Events", description: "See what’s coming up.", suggestion: "See what’s happening nearby.", tone: "blue", icon: PartyPopper, featureIcon: "events", accent: "text-violet-500 dark:text-violet-400" },
  { href: "/discover", label: "Socialize", description: "Find people who are open to socializing.", suggestion: "Meet people open to socializing.", tone: "lavender", icon: Compass, featureIcon: "socialize", accent: "text-violet-500 dark:text-violet-400" },
  { href: "/safe-arrival", label: "Safe Arrival", description: "Let trusted Muddies know when you arrive safely.", suggestion: "Let your circle know you got there.", tone: "blue", icon: ShieldCheck, featureIcon: "safeArrival", accent: "text-sky-500 dark:text-sky-400" },
  { href: "/moments", label: "Moments", description: "Share a moment before it disappears.", suggestion: "Share something before it’s gone.", tone: "blush", icon: Sparkles, featureIcon: "moments", accent: "text-primary" },
  { href: "/groups", label: "Groups", description: "Open your groups and invitations.", suggestion: "Catch up with your groups.", tone: "green", icon: Users2, featureIcon: "groups", accent: "text-sky-500 dark:text-sky-400" },
  { href: "/reminders", label: "Reminders", description: "Reminders for plans and connections.", suggestion: "Stay on top of what’s next.", tone: "orange", icon: Bell, featureIcon: "reminders", accent: "text-amber-500 dark:text-amber-400" },
  { href: "/settings/engagement", label: "Focus", description: "Manage Focus Mode and notification limits.", suggestion: "Quieten things down for a while.", tone: "blush", icon: Moon, featureIcon: "focus", accent: "text-pink-500 dark:text-pink-400" }
];

/**
 * The suggestions surfaced on the Home rail, in order. The rest stay
 * available through "More to explore" lower down.
 */
const PRIMARY_ACTION_HREFS = ["/hangout-mode", "/invites", "/plans?create=1", "/events"];

/** How many suggestions the Home rail renders before the rest fall through. */
const SUGGESTION_COUNT = 4;

/**
 * Splits the flag-filtered actions into the rail's suggestions and the rest.
 * Shared by the rail and the bottom gap-filler so a promoted action is never
 * shown twice.
 *
 * This is availability filtering, not ranking: the order comes from the list
 * above, and a server-driven recommendation could replace `primary` wholesale
 * without the card component changing.
 */
function splitQuickActions(hiddenHrefs: string[]): { primary: QuickAction[]; secondary: QuickAction[] } {
  const available = quickActions.filter((action) => !hiddenHrefs.includes(action.href));
  // If one (e.g. Socialize) is disabled by Owner controls, backfill from the
  // remaining actions so there is never an empty gap where a feature used to be.
  const primary: QuickAction[] = available.filter((action) => PRIMARY_ACTION_HREFS.includes(action.href));
  const rest = available.filter((action) => !PRIMARY_ACTION_HREFS.includes(action.href));
  while (primary.length < SUGGESTION_COUNT && rest.length > 0) {
    primary.push(rest.shift()!);
  }
  return { primary, secondary: rest };
}

/**
 * Home's "Suggestions for you" rail.
 *
 * Replaces the old Quick Actions grid. These read as recommendations rather
 * than navigation: a soft pastel surface per card, a short suggestion
 * sentence, and no dense icon grid.
 *
 * `primary` is simply rendered in the order given — this component holds no
 * ranking of its own, so a future server-driven recommendation set can be
 * dropped in without touching it. The section hides entirely when empty.
 *
 * The tour target stays attached here: a shipped walkthrough migration
 * references `home-quick-actions`, so the id must keep resolving to a real,
 * visible element even though the section is no longer called Quick actions.
 */
function QuickActionsHome({
  primary,
  secondary
}: {
  primary: QuickAction[];
  secondary: QuickAction[];
}) {
  const [moreOpen, setMoreOpen] = useState(false);
  const railRef = useRef<HTMLDivElement>(null);
  // One shared controller for the whole rail, not a timer per card. Pauses
  // while the rail is being touched or scrolled, while the More sheet is
  // open, and while the tab is hidden.
  const railBusy = useInteractionPause(railRef);
  const sweepingIndex = useSequenceHighlight(primary.length, { paused: railBusy || moreOpen });

  // No suggestions available (every feature flagged off) — hide the section
  // rather than render an empty placeholder.
  if (primary.length === 0) return null;

  return (
    <section aria-labelledby="home-actions-heading" data-tour-id={TOUR_TARGET_IDS.HOME_QUICK_ACTIONS}>
      {/* Canonical section header. "See all" opens the More sheet rather than
          navigating, which is why this passes onAction instead of href. */}
      <PageSectionHeader
        id="home-actions-heading"
        title="Suggestions for you"
        onAction={secondary.length > 0 ? () => setMoreOpen(true) : undefined}
        actionAriaLabel="See all suggestions"
      />

      {/* Horizontal rail. Cards are a fixed width so roughly three fit on a
          standard phone with the fourth peeking, which is what signals the
          row scrolls — no indicators needed. */}
      <div
        ref={railRef}
        className="-mx-4 flex gap-2.5 overflow-x-auto px-4 pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:-mx-6 sm:px-6"
      >
        {primary.map((action, index) => (
          // Exactly one card sweeps at a time, chosen by rendered index — the
          // suggestion order is never touched.
          <SuggestionCard key={action.href} action={action} sweeping={index === sweepingIndex} />
        ))}
      </div>

      <Modal
        open={moreOpen}
        onOpenChange={setMoreOpen}
        title="More suggestions"
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

/**
 * One suggestion. A calm pastel surface, a small rounded icon chip, a title
 * and one short sentence — closer to a widget than a shortcut button.
 */
function SuggestionCard({ action, sweeping = false }: { action: QuickAction; sweeping?: boolean }) {
  const tone = SUGGESTION_TONE[action.tone];
  const Icon = action.icon;

  return (
    <Link
      href={action.href}
      // One label carrying both the action and why it is being suggested. The
      // border is decorative and carries no meaning, so it adds nothing here.
      aria-label={`${action.label}. ${action.suggestion}`}
      // Per-card edge colours for the rotating border (see .suggestion-card in
      // globals.css). Custom properties only — no inline animation.
      style={{ "--sug-a": tone.edge.a, "--sug-b": tone.edge.b } as CSSProperties}
      className={cn(
        // ~7.75rem keeps three cards fully visible at 390px with the fourth
        // peeking, which is what signals the rail scrolls.
        //
        // NOT overflow-hidden: the animated rim sits at inset -1px behind the
        // card, and clipping would cut it off. The content has no overflow of
        // its own — both text blocks are line-clamped.
        "focus-ring safe-motion suggestion-card relative flex w-[7.75rem] shrink-0 flex-col rounded-[1.25rem] border border-black/[0.04] p-3 shadow-[0_1px_3px_hsl(var(--shadow)/0.05)] transition-[transform,box-shadow] active:scale-[0.98] active:shadow-[0_4px_14px_hsl(var(--shadow)/0.12)] motion-reduce:transition-none motion-reduce:active:scale-100 dark:border-white/[0.06]",
        sweeping && "is-sweeping",
        tone.surface
      )}
    >
      <span className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-[0.625rem]", tone.icon)}>
        <Icon className="h-[18px] w-[18px]" strokeWidth={1.75} aria-hidden="true" />
      </span>
      <span className="mt-2.5 line-clamp-2 text-[0.8125rem] font-semibold leading-tight">
        {action.label}
      </span>
      <span className="mt-1 line-clamp-2 text-[0.75rem] leading-[1.35] text-muted-foreground">
        {action.suggestion}
      </span>
    </Link>
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

/**
 * Home's single upcoming-Plan preview.
 *
 * The Plan shown is `upcomingPlans[0]` — the soonest by `start_at`, ordered
 * server-side by loadUpcomingPlans. No ranking is computed here.
 *
 * Everything rendered comes from the existing authorised projection: the venue
 * is the plan's own `custom_place_text` (never a coordinate or a private
 * address), and the attendee faces are the same "going" profiles the Plans
 * page uses.
 */
function UpcomingPlanRow({ plan }: { plan: HomeUpcomingPlan }) {
  const startAt = new Date(plan.startAt);
  // Split date and time so they can carry different weight — the date is what
  // people scan for, the time qualifies it.
  const day = startAt.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
  const time = startAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  // "Hosting" when the projection already says this viewer created the plan.
  // Not inferred: loadUpcomingPlans sets organiserName to the literal "You"
  // for the creator. It has to be checked here because the same projection
  // collapses a host's own attendance into myRsvp: "going", so the RSVP alone
  // cannot tell a host from an attendee.
  const attendance = plan.organiserName === "You" ? "Hosting" : rsvpLabel(plan.myRsvp);
  // goingCount is the canonical number; the faces are a capped sample of it.
  const extraAttendees = Math.max(0, plan.goingCount - plan.attendees.slice(0, 3).length);

  return (
    <section aria-labelledby="home-plan-heading" data-tour-id={TOUR_TARGET_IDS.HOME_UPCOMING_PLAN}>
      <PageSectionHeader
        id="home-plan-heading"
        title="Upcoming Plans"
        href="/plans"
        actionAriaLabel="See all plans"
      />

      {/* One tappable card. There is no /plans/[id] route in the app, so this
          opens the canonical Plans page — the same destination the previous
          preview used. No new navigation is introduced here. */}
      <Link
        href="/plans"
        aria-label={`${capitalize(plan.title)}, ${day} at ${time}${
          plan.placeText ? `, ${capitalize(plan.placeText)}` : ""
        }, ${attendance}`}
        className="focus-ring safe-motion flex items-center gap-3 rounded-[1.375rem] border border-border/70 bg-card px-4 py-4 shadow-[0_1px_3px_hsl(var(--shadow)/0.06)] transition-transform active:scale-[0.99] motion-reduce:active:scale-100 dark:bg-[#1a1a1d]"
      >
        {/* The plan's cover, resolved by the canonical system: a user upload
            if there is one, otherwise the category illustration, otherwise
            the branded fallback. This card never picks an image itself. */}
        <PlanCover
          category={plan.category}
          coverImageUrl={plan.coverImageUrl}
          rounded="rounded-[0.875rem]"
          className="h-14 w-14 shrink-0"
        />

        {/* Three metadata rows, each led by its own icon: what, when, where.
            The icons form a consistent left rail so the three lines scan as a
            set rather than as a paragraph. */}
        <div className="min-w-0 flex-1 space-y-1.5">
          {/* No leading icon on the title row: the cover to its left already
              identifies the plan, so a calendar glyph here would be a second
              marker for the same thing. */}
          <p className="truncate text-[0.9375rem] font-semibold leading-tight">
            {capitalize(plan.title)}
          </p>
          {/* Date/time and venue are secondary and scannable. Each line
              truncates as a unit so a long venue can never wrap the card. */}
          <p className="flex items-center gap-2 text-[0.8125rem] leading-tight text-muted-foreground">
            <Clock className={PLAN_ICON} strokeWidth={1.75} aria-hidden="true" />
            <span className="truncate" suppressHydrationWarning>
              {day} • {time}
            </span>
          </p>
          {plan.placeText ? (
            <p className="flex items-center gap-2 text-[0.8125rem] leading-tight text-muted-foreground">
              <MapPin className={PLAN_ICON} strokeWidth={1.75} aria-hidden="true" />
              <span className="truncate">{capitalize(plan.placeText)}</span>
            </p>
          ) : null}
        </div>

        {/* Faces and count sit on one line, vertically centred against the
            three metadata rows; the attendance state tucks underneath so it
            never competes with them for horizontal space. */}
        <div className="flex shrink-0 flex-col items-end gap-1.5 self-center">
          {plan.attendees.length > 0 ? (
            // Faces are the first thing to go on a narrow screen: they are
            // decorative, while the title, time and venue are not. Below
            // 380px only the count remains, which keeps the text column wide
            // enough that the time is never truncated.
            <span className="flex items-center" aria-hidden="true">
              <span className="hidden -space-x-2 min-[380px]:flex">
                {plan.attendees.slice(0, 3).map((attendee, index) => (
                  <span
                    key={`${attendee.name}-${index}`}
                    // Plain avatars: the attendee projection carries no
                    // membership tier, and a tier must never be inferred.
                    className="grid h-7 w-7 place-items-center overflow-hidden rounded-full border-2 border-card bg-secondary text-[10px] font-semibold uppercase text-muted-foreground dark:border-[#1a1a1d]"
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
              {/* Two forms of the same count. Wide: the faces plus whoever
                  they don't cover ("+12"). Narrow: the faces are hidden, so
                  the total going count stands alone ("12 going") and no
                  information is lost. */}
              {extraAttendees > 0 ? (
                <span className="ml-1.5 hidden text-xs font-semibold tabular-nums text-muted-foreground min-[380px]:inline">
                  +{extraAttendees}
                </span>
              ) : null}
              {/* Below 340px even this count squeezes the text column hard
                  enough to truncate the DATE, which is core information being
                  lost to a secondary detail. The attendance pill still says
                  what matters, and the full roster is one tap away. */}
              <span className="hidden text-xs font-semibold tabular-nums text-muted-foreground min-[340px]:inline min-[380px]:hidden">
                {plan.goingCount} going
              </span>
            </span>
          ) : null}
          <span className="rounded-full bg-primary/12 px-2 py-0.5 text-[0.6875rem] font-semibold text-primary">
            {attendance}
          </span>
        </div>
      </Link>
    </section>
  );
}

/**
 * Shown in place of the card when there is nothing coming up. Deliberately a
 * light invitation rather than an empty card, matching the Near section's
 * treatment.
 */
function UpcomingPlanEmpty() {
  return (
    <section aria-labelledby="home-plan-heading">
      {/* No action: with nothing upcoming there is nothing to see all of. */}
      <PageSectionHeader id="home-plan-heading" title="Upcoming Plans" />
      <div className="flex items-center gap-3.5 py-1">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-border/60 text-muted-foreground">
          <CalendarDays className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold">No upcoming Plans.</p>
          <p className="mt-0.5 text-[0.8125rem] leading-5 text-muted-foreground">
            {/* The canonical creation route, same as every other Create entry. */}
            <Link
              href="/plans?create=1"
              className="focus-ring rounded font-medium text-[var(--color-brand-orange)] hover:underline"
            >
              Create a Plan
            </Link>{" "}
            with your Muddies.
          </p>
        </div>
      </div>
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
