"use client";

import Link from "next/link";
import type { Route } from "next";
import {
  AlertTriangle,
  Bell,
  CheckCircle2,
  ChevronRight,
  CalendarDays,
  CircleDollarSign,
  Compass,
  Ghost,
  Hand,
  MessageSquareText,
  Moon,
  PartyPopper,
  Search,
  ShieldCheck,
  MessageCircle,
  UserPlus,
  Users,
  Users2,
  X
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { createMeetupRequestAction } from "@/app/(app)/premium-actions";
import { updateVisibilityStatusAction } from "@/app/(app)/settings-actions";
import { MobilePageHeader } from "@/components/app-shell/mobile-page-header";
import { MomentsPreview } from "@/components/content/moments-preview";
import { useRouter } from "next/navigation";
import { PageSectionHeader } from "@/components/app-shell/page-section-header";
import { PlanStack } from "@/components/socialize/plan-stack";
import { rsvpAction } from "@/app/(app)/plans-actions";
import { sendWaveV2Action } from "@/app/(app)/social-actions";
import type { VisibleMoment } from "@/lib/content/service";
import { useUnreadNotifications } from "@/hooks/unread-notification-context";
import { usePullRefreshListener } from "@/components/ui/pull-to-refresh";
import { appCache, cacheKeys } from "@/lib/cache/entity-cache";
import type { PublicMembershipTier } from "@/lib/billing/premium-identity";
import { useAppMenu } from "@/hooks/app-menu-context";
import { useInteractionPause, useSequenceHighlight } from "@/hooks/use-sequence-highlight";
import { QuickControlsSheet } from "@/components/dashboard/quick-controls-sheet";
import { SplitText } from "@/components/ui/split-text";
import { ProximityGlowAvatar } from "@/components/glow/proximity-glow-avatar";
import type { ProximityBand } from "@/lib/proximity/bands";
import { proximityBandLabel } from "@/lib/proximity/bands";
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
import type { FeatureIconKey } from "@/lib/icons/feature-icons";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { fetchWithTimeout } from "@/lib/network/resilience";
import { formatMuddyStatusLabel } from "@/lib/social/rules";
import type { HomeUpcomingPlan } from "@/lib/social/upcoming-plans";
import type { UpcomingAgendaItem } from "@/lib/social/upcoming-agenda";
import { type FreshnessState } from "@/lib/proximity/freshness";
import { proximityLabels, type ConfidenceLevel, type ProximityLevel } from "@/lib/proximity";
import type { ActivityType, AvailabilityType, SubscriptionPlan } from "@/lib/supabase/database.types";
import { cn } from "@/lib/utils";
import { TOUR_TARGET_IDS } from "@/lib/tours/registry";
import { SmartCardHero } from "@/components/journey/smart-card";
import { ActivationCard } from "@/components/activation/activation-card";
import { FirstMuddyCard } from "@/components/activation/first-muddy-card";
import type { ActivationAction, ActivationState } from "@/lib/activation/state";
import { planActionsForMuddy } from "@/lib/activation/state";
import { Button } from "@/components/ui/button";
import type { RelationshipFocus } from "@/lib/activation/relationship-focus";
import { openDirectConversationAction } from "@/app/(app)/messaging-actions";
import { conversationHref } from "@/lib/messaging/open-conversation";
import {
  composeHome,
  earlyActivationHiddenActionHrefs,
  type NextBestAction
} from "@/lib/activation/home-composition";
import { TopEventsHome } from "@/components/events/top-events-home";
import type { RankedEvent } from "@/lib/events/ranked-events";
import type { SmartCard } from "@/lib/smart-card/smart-card";

type DashboardFriend = {
  friendId: string;
  displayName: string;
  username: string;
  avatarUrl: string | null;
  proximityLevel: ProximityLevel;
  /** Six-state presentation band from the API. Drives the Glow and its label. */
  proximityBand: ProximityBand;
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
  proximity_band: ProximityBand;
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
  /** Plans and qualifying Events in one chronological Home stack. */
  agendaItems?: UpcomingAgendaItem[];
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
   * What this person needs next, derived server-side from their real
   * situation. Null once they are activated, or when logged out.
   */
  activationState?: ActivationState | null;
  /**
   * The Muddy to acknowledge, or null once the moment has passed.
   * Server-derived from milestone recency -- never a client flag.
   */
  firstMuddy?: { displayName: string; avatarUrl: string | null } | null;
  firstMuddyNeedsLocation?: boolean;
  /**
   * Milestones this person has ever reached.
   *
   * Composition asks whether somebody has arrived somewhere, not how many
   * Muddies they have -- a long-standing user with a small circle must keep
   * their ordinary Home.
   */
  activationMilestones?: readonly string[];
  /**
   * The relationship Home should name, with its chosen actions.
   *
   * Server-derived from canonical projections. Identity only -- no proximity.
   */
  relationshipFocus?: RelationshipFocus | null;
  /** Direct conversations where both people have written. Maturity evidence. */
  twoSidedConversationCount?: number;
  /** Plans this person is on. Maturity evidence. */
  planParticipationCount?: number;
  /** Live, mutual Muddies. */
  muddyCount?: number;
  /**
   * Muddies the SERVER resolved as nearby at render time.
   *
   * Home's own nearby list is fetched after mount, so between render and that
   * response the section has no data. Without the server's answer it cannot
   * tell "still loading" from "genuinely nobody", and showed the empty state
   * to somebody the server had already found a Muddy for.
   */
  /**
   * The privacy-safe nearby people the server already resolved.
   *
   * Rendered immediately so Home never starts from zero and never shows
   * placeholders for people it already knows. Bands only -- no coordinates.
   */
  serverNearby?: NearbyFriendApiItem[];
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
  /**
   * Top 5 ranked Events (Ranked Events Discovery). Ranked server-side by the
   * one canonical loader, so Home and the full Top Events list can never
   * disagree about what rank an event holds. Empty is a valid, common answer
   * and renders nothing rather than a placeholder.
   */
  topEvents?: RankedEvent[];
  /** Moments (paused). Server-resolved; hides every Home Moments surface. */
  momentsEnabled?: boolean;
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
/* How many nearby Muddies appear BENEATH the focused one.
 *
 * Small on purpose: Home surfaces the moment, /friends is the directory. Three
 * keeps a phone screen calm while still saying "several people are around". */
const NEARBY_SUPPORTING_LIMIT = 3;

function capitalize(name: string) {
  return name ? name.charAt(0).toUpperCase() + name.slice(1) : name;
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

/** "Ama Serwaa" -> "Ama". The greeting uses a first name, not a full one. */
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
  agendaItems = [],
  glowColorByFriendId = {},
  profileReminder = null,
  safeArrival = null,
  hiddenQuickActionHrefs = [],
  smartCard = null,
  activationState = null,
  firstMuddy = null,
  firstMuddyNeedsLocation = false,
  activationMilestones = [],
  relationshipFocus = null,
  twoSidedConversationCount = 0,
  planParticipationCount = 0,
  muddyCount = 0,
  serverNearby = [],
  moments = [],
  air = [],
  isFirstTimeUser = false,
  topEvents = [],
  momentsEnabled = false,
  incomingRequestCount = 0
}: DashboardPageContentProps) {
  const reducedMotion = useReducedMotion();
  const [ghostMode, setGhostMode] = useState(initialVisibilityStatus === "ghost");
  /* SEEDED FROM THE SERVER, not from nothing.
   *
   * This started empty, so a screen the server could render complete began at
   * zero and asked the browser to fetch the same people again -- and when that
   * fetch settled empty, Home showed anonymous placeholders for people it
   * already knew about. The client refresh now reconciles known truth instead
   * of discovering it. */
  const [friends, setFriends] = useState<DashboardFriend[]>(() =>
    serverNearby.map(toDashboardFriend)
  );
  const [statusMessage, setStatusMessage] = useState("");
  const [isCheckingNearby, setIsCheckingNearby] = useState(false);
  const [promptFeedback, setPromptFeedback] = useState<{ title?: string; message: string; error: boolean } | null>(
    null
  );
  /* Muddies waved at during THIS session.

   *

   * Not a cooldown of our own: the server owns eligibility. This only stops

   * Home re-offering a Wave it has just been told was accepted, until the next

   * projection read supplies the authoritative answer again. */

  /* The Muddy a wave is in flight for, or null.


   *


   * Separate from the shared `isPending`: only this button should say


   * "Waving…", and Say hi beside it must stay usable. */


  const [wavingMuddyId, setWavingMuddyId] = useState<string | null>(null);


  const [wavedMuddyIds, setWavedMuddyIds] = useState<ReadonlySet<string>>(() => new Set());

  const [selectedFriendId, setSelectedFriendId] = useState<string | null>(null);
  const router = useRouter();
  const [quickControlsOpen, setQuickControlsOpen] = useState(false);
  // The app-wide menu sheet lives in AppShell; Home just asks it to open.
  const openAppMenu = useAppMenu();
  // The shell's canonical unread count, read from context — not a second
  // counter, not another poller, and not derived from anything on this page.
  const unreadNotificationCount = useUnreadNotifications();
  const [isPending, startTransition] = useTransition();
  // Nearby is fetched client-side after mount, so there is a real window with
  // no data yet. Distinguishes "still loading" from "genuinely nobody nearby".
  /* Unknown only when the server had nothing either. With server-hydrated
     people there is no initial-unknown phase to show a skeleton for. */
  const [nearbyLoaded, setNearbyLoaded] = useState(serverNearby.length > 0);
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
          /* The ACTIVATION state is server-derived, so a new fix has to reach
             the projection or Home would keep asking for a location it now
             has. Nearby is client-fetched above; this is what moves somebody
             from "Turn on Glow" to "Glow is ready" without a manual reload. */
          router.refresh();
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

  /**
   * Turn Glow on, from the card that asked.
   *
   * THE CANONICAL PATH, NOT A SECOND ONE. `updatePrivateLocation` is the same
   * callback Quick Controls and pull-to-refresh already use -- it raises the
   * OS prompt and posts to /api/location/update -- and the visibility change
   * goes through `updateVisibilityStatusAction`, which authorises server-side
   * exactly as Settings does. Nothing about the privacy rules is re-decided
   * here; Home only chooses WHEN to ask.
   *
   * router.refresh() so the next state comes from the server projection. The
   * alternative -- guessing the new activation state locally -- is how a
   * screen ends up disagreeing with the account behind it.
   */
  function enableVisibilityFromActivation() {
    if (isPending) return;
    startTransition(async () => {
      const result = await updateVisibilityStatusAction("visible");
      showPromptFeedback(
        result.ok ? "Glow is on. Your Muddies can see when you're close by." : result.message,
        !result.ok
      );
      if (result.ok) router.refresh();
    });
  }

  /**
   * The activation card's primary action, for the states Home can complete.
   *
   * Returns undefined elsewhere, so those keep their ordinary link -- the card
   * decides nothing about which states these are.
   */
  /**
   * The engine's action names, in the words a person would use.
   *
   * One place, so the button and any later guidance describe the same thing.
   */
  const ACTION_LABEL: Record<ActivationAction, string> = {
    say_hi: "Say hi",
    message: "Message",
    wave: "Wave",
    make_plan: "Make a Plan",
    view_plan: "Open Plan",
    find_muddies: "Find Muddies",
    enable_location: "Turn on Glow",
    refresh_location: "Refresh Glow",
    enable_visibility: "Turn on visibility"
  };

  /* Only the quiet-evening state names a person.
   *
   * Nearby has its own payoff surface, and the setup states are about the
   * viewer's own account rather than any relationship. */
  const focusedRelationship =
    activationState === "no_one_nearby" ? relationshipFocus ?? null : null;

  /* A STALE FIX BLOCKS PROXIMITY CLAIMS, NOT THE RELATIONSHIP.
   *
   * The recovery card replaced the whole relationship section, so somebody
   * whose location had merely gone quiet lost Message and Make a Plan too --
   * neither of which depends on knowing where anybody is. Refreshing stays the
   * primary action, because it is what unblocks Glow; the person they were
   * talking to returns as the quiet secondary rather than disappearing. */
  const staleRelationship =
    activationState === "location_stale" ? relationshipFocus ?? null : null;

  const activationPrimaryAction =
    activationState === "muddies_no_location" || activationState === "location_stale"
      ? updatePrivateLocation
      : activationState === "visibility_off"
        ? enableVisibilityFromActivation
        : undefined;

  /**
   * The contextual first action, run against a real relationship.
   *
   * CANONICAL PATHS ONLY. Say hi resolves the direct conversation through
   * `openDirectConversationAction` — the same entry New Message uses — and
   * then opens it so the person writes their own words. Nothing is auto-sent:
   * a message the app composed and signed with somebody's name is not a
   * greeting, it is the product talking to itself.
   */
  function runRelationshipAction(action: ActivationAction, muddyId: string) {
    if (isPending) return;

    if (action === "make_plan") {
      /* CARRIES THE PERSON, NOT A PLACE.
       *
       * The composer opened with nobody selected, so somebody who tapped
       * "Make a Plan" on Kofi had to search for Kofi again -- the product
       * forgetting what they had just done. Only the Muddy id travels: no
       * coordinates, no band, no proximity of any kind. Nearby is the social
       * context that led here, not a location payload. */
      router.push(`/plans?create=1&with=${encodeURIComponent(muddyId)}` as Route);
      return;
    }

    startTransition(async () => {
      const result = await openDirectConversationAction(muddyId);
      if (!result.ok || !result.conversationId) {
        // Stay on Home and say what happened. Never fake a success.
        showPromptFeedback(result.message, true);
        return;
      }
      /* The CANONICAL destination helper, not a hand-built path.
       *
       * This used to interpolate `/messages/${id}`, which matches no route --
       * there is no [id] segment under /messages, only a page that reads
       * ?conversation= -- so every Say hi landed on the 404. Three other
       * surfaces already went through conversationHref; Home was the one
       * spelling the URL itself, which is exactly how it got a different
       * answer from the rest of the product. */
      router.push(conversationHref(result.conversationId));
    });
  }

  /**
   * A wave, from the nearby payoff.
   *
   * THE CANONICAL ACTION, unchanged: sendWaveV2Action owns authorisation, the
   * pair cooldown, block state and the notification. Home only chooses when to
   * offer it, and the engine has already refused to offer it when the server
   * would bounce it.
   */
  async function waveAtMuddy(muddyId: string) {
    if (isPending || wavingMuddyId) return;

    /* THE CONFIRMATION IS URGENT; THE RECONCILIATION IS NOT.
     *
     * This whole handler used to sit inside startTransition, so the "Wave
     * sent" toast was a non-urgent update batched with the re-render that
     * dropped the Wave button. React painted them together and the sender saw
     * only the button change -- a wave that had genuinely been delivered
     * looked like nothing had happened.
     *
     * Awaiting the action directly keeps the toast an ordinary urgent update,
     * so it paints on its own. Only the action-list reconciliation goes into a
     * transition afterwards. */
    setWavingMuddyId(muddyId);
    let result: Awaited<ReturnType<typeof sendWaveV2Action>>;
    try {
      result = await sendWaveV2Action(muddyId);
    } catch {
      setWavingMuddyId(null);
      showPromptFeedback("Wave couldn't be sent right now.", true);
      return;
    }
    setWavingMuddyId(null);
    showPromptFeedback(result.message, !result.ok);

    /* REFLECTS the server's answer; never decides eligibility.
     *
     * A successful wave starts the canonical pair cooldown, so continuing to
     * offer Wave would leave a button the server will predictably refuse.
     * Recording who was waved at lets the decision engine drop it on the
     * next render -- the client is not running a timer, it is remembering an
     * outcome the server already committed. Cleared by any reload, where the
     * projection's own cooldown read takes over again. */
    if (result.ok) {
      startTransition(() => {
        setWavedMuddyIds((waved) => new Set(waved).add(muddyId));
      });
    }
  }

  /**
   * RSVP from the Home plan stack.
   *
   * The canonical action, unchanged — the card decides only what to OFFER,
   * and the server still authorises. router.refresh() rather than local state
   * so the count and the attendee faces come back from the projection rather
   * than being guessed here.
   */
  function joinPlan(plan: HomeUpcomingPlan) {
    if (isPending) return;
    startTransition(async () => {
      const result = await rsvpAction(plan.id, "going");
      showPromptFeedback(result.message, !result.ok);
      if (result.ok) router.refresh();
    });
  }

  // Quick actions are split once here so the launcher row, the More sheet and
  // the bottom gap-filler stay in agreement: whatever the filler promotes is
  // removed from More, and returns to More when the space is needed again.
  const { primary: primaryActions, secondary: secondaryActions } = useMemo(
    () => splitQuickActions(hiddenQuickActionHrefs),
    [hiddenQuickActionHrefs]
  );

  const hasSafeArrival =
    safeArrival !== null &&
    (safeArrival.travelling.length > 0 || safeArrival.checkingOn.length > 0 || safeArrival.invitations.length > 0);

  /* WHO OWNS THE SCREEN. Decided once, from state, so no section has to guess.
   *
   * Home was giving a first-time user three proximity instructions at once:
   * the activation card asking for Glow, the Near module below it saying
   * visibility was paused, and Trending offering events. Activation is the
   * authority while it is still teaching; the rest wait their turn. */
  const compositionInputs = useMemo(
    () => ({
      activationState,
      acknowledgingFirstMuddy: firstMuddy !== null,
      milestones: new Set(activationMilestones),
      hasSafetyCard: hasSafeArrival,
      upcomingPlanCount: agendaItems.length,
      twoSidedConversationCount,
      planParticipationCount,
      muddyCount,
      nextUnspokenMuddy: relationshipFocus?.nextUnspokenMuddy ?? null,
      heroPrimaryAction: relationshipFocus?.plan.primary,
      missingProfileItems: profileReminder?.missingItems ?? []
    }),
    [
      activationState,
      firstMuddy,
      activationMilestones,
      hasSafeArrival,
      agendaItems.length,
      twoSidedConversationCount,
      planParticipationCount,
      muddyCount,
      profileReminder,
      relationshipFocus
    ]
  );
  const composition = useMemo(() => composeHome(compositionInputs), [compositionInputs]);

  /* THE PAYOFF'S ACTIONS, from the one engine.
   *
   * Only when exactly one Muddy is nearby and the projection's focused
   * relationship is that same person -- otherwise the pair would describe
   * somebody who is not on screen. `isNearby: true` is the whole point: it is
   * what turns a Plan suggestion into a Wave. */
  const soloNearbyMuddy =
    nearbyFriends.find((friend) => friend.friendId === relationshipFocus?.muddy.id) ?? null;
  const soloNearbyPlan =
    soloNearbyMuddy && relationshipFocus?.muddy.id === soloNearbyMuddy.friendId
      ? planActionsForMuddy({
          hasSharedUpcomingPlan: relationshipFocus.plan.reason === "shared_plan",
          hasExistingConversation: relationshipFocus.plan.primary !== "say_hi",
          conversationState: relationshipFocus.plan.primary === "say_hi" ? "none" : "started",
          isNearby: true,
          /* The server's own answer, minus anybody waved at just now.
             Offering a Wave the cooldown will refuse is a dead button, and
             `true` here meant Wave survived its own success. */
          waveAvailable:
            relationshipFocus.waveAvailable && !wavedMuddyIds.has(soloNearbyMuddy.friendId)
        })
      : null;

  // Narrowed once so both the label and the handler are typed.
  const soloSecondary = soloNearbyPlan?.secondary ?? null;
  const soloNearbyActions =
    soloNearbyMuddy && soloNearbyPlan ? (
      <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
        <Button
          size="lg"
          className="min-w-[11rem]"
          /* Blocks a second tap of THIS action without freezing the other:
             a wave in flight must not make Say hi unusable. */
          disabled={isPending || wavingMuddyId !== null}
          data-home-action={soloNearbyPlan.primary}
          onClick={() =>
            soloNearbyPlan.primary === "wave"
              ? waveAtMuddy(soloNearbyMuddy.friendId)
              : runRelationshipAction(soloNearbyPlan.primary, soloNearbyMuddy.friendId)
          }
        >
          {/* The pending phase, on this button only: Say hi beside it stays
              usable, and the label change is what makes the tap feel received. */}
          {soloNearbyPlan.primary === "wave" && wavingMuddyId === soloNearbyMuddy.friendId
            ? "Waving…"
            : ACTION_LABEL[soloNearbyPlan.primary]}
        </Button>
        {soloSecondary ? (
          <button
            type="button"
            disabled={isPending || wavingMuddyId !== null}
            onClick={() =>
              soloNearbyPlan.secondary === "wave"
                ? waveAtMuddy(soloNearbyMuddy.friendId)
                : runRelationshipAction(soloNearbyPlan.secondary!, soloNearbyMuddy.friendId)
            }
            // min-h-11 + px-3: 44px minimum touch target. Wave is a real action on
            // the Home surface and measured 43x32 -- under the minimum on both
            // axes, with almost no horizontal padding to aim at.
            className="focus-ring inline-flex min-h-11 items-center rounded-lg px-3 py-1.5 text-sm font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline disabled:opacity-60"
          >
            {soloSecondary === "wave" && wavingMuddyId === soloNearbyMuddy.friendId
              ? "Waving…"
              : ACTION_LABEL[soloSecondary]}
          </button>
        ) : null}
      </div>
    ) : null;

  /* Resolved once, against the real person. Null when the chosen action cannot
     be spoken concretely -- Home then simply ends. */
  const nextStep = useMemo(
    () =>
      composition.nextBestAction
        ? resolveNextStep(composition.nextBestAction, relationshipFocus?.nextUnspokenMuddy ?? null)
        : null,
    [composition.nextBestAction, relationshipFocus]
  );

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

        {/* ONE greeting, not two.
            A fixed "Welcome" heading sat directly above a time-of-day line, so
            Home opened by greeting the same person twice in two type sizes and
            spent its most valuable vertical space saying nothing. The
            time-of-day line already carries who and when, so it becomes the
            heading and the redundant title is gone. */}
        <div className="min-w-0">
          <SplitText
            tag="h1"
            text={greetingSubtitle(displayName || null, new Date())}
            splitType="chars"
            delay={45}
            duration={0.55}
            ease="power3.out"
            from={{ opacity: 0, y: 24 }}
            to={{ opacity: 1, y: 0 }}
            textAlign="left"
            className="truncate text-2xl font-bold leading-tight tracking-tight"
          />
        </div>

        {/* HERO: the Smart Card — Home's single canonical card and its main
            visual focal point. There is always exactly one, never a carousel,
            and it never disappears: the server picks the highest-priority
            applicable card from the ordered provider list, and only the
            content changes. profileReminder (below, near the visibility card)
            is a smaller secondary nudge, not a replacement. */}
        {/* The relationship first, the capability second. While this is showing it
            REPLACES the generic activation card -- two cards asking for the same
            thing is the app repeating itself at the moment it should be warm. */}
        {firstMuddy ? (
          <FirstMuddyCard muddy={firstMuddy} needsLocation={firstMuddyNeedsLocation} className="mb-4" />
        ) : activationState ? (
          <ActivationCard
            state={activationState}
            className="mb-4"
            /* The quiet-evening card speaks about a real relationship; every
               other state keeps its own action. `focusedRelationship` is null
               unless this is that state, so one check gates all of it. */
            onPrimaryAction={
              focusedRelationship
                ? () =>
                    runRelationshipAction(
                      focusedRelationship.plan.primary,
                      focusedRelationship.muddy.id
                    )
                : activationPrimaryAction
            }
            pending={isPending || isCheckingNearby}
            pendingLabel="Working…"
            /* The stale card keeps the person visible; refreshing stays its
               primary action, so the relationship rides as the secondary. */
            relationship={(focusedRelationship ?? staleRelationship)?.muddy ?? null}
            primaryLabel={
              focusedRelationship ? ACTION_LABEL[focusedRelationship.plan.primary] : undefined
            }
            primaryActionId={focusedRelationship?.plan.primary}
            secondaryLabel={
              focusedRelationship?.plan.secondary
                ? ACTION_LABEL[focusedRelationship.plan.secondary]
                : staleRelationship
                  ? ACTION_LABEL[staleRelationship.plan.primary]
                  : undefined
            }
            onSecondaryAction={
              focusedRelationship?.plan.secondary
                ? () =>
                    runRelationshipAction(
                      focusedRelationship.plan.secondary!,
                      focusedRelationship.muddy.id
                    )
                : staleRelationship
                  ? () =>
                      runRelationshipAction(
                        staleRelationship.plan.primary,
                        staleRelationship.muddy.id
                      )
                  : undefined
            }
          />
        ) : null}
        {/* SAFETY ALWAYS; A SECOND ACTIVATION GUIDE NEVER.
            safe_arrival is a live journey somebody is on -- it outranks
            activation and keeps its full treatment. The `journey` card is
            Mad Buddy's OTHER activation system, and its "Turn On Visibility"
            step repeats this screen's instruction with a different
            destination, so it stands down rather than merely dimming. */}
        {smartCard && (smartCard.id === "safe_arrival" || composition.showJourneyCard) ? (
          <SmartCardHero
            card={smartCard}
            deferred={Boolean(activationState) && smartCard.id !== "safe_arrival"}
          />
        ) : null}

        {/* HERO: Nearby Muddies.

            Stands down while activation is teaching. Its empty state gives the
            same instruction the activation card is already giving -- "Turn
            visibility back on" under a card saying "Turn on Glow" -- and two
            surfaces disagreeing about the next step is worse than either. It
            returns the moment activation recedes, which includes the payoff
            state where somebody is actually nearby. */}
        {composition.showNearby ? (
          <NearbyHero
            friends={nearbyFriends}
            total={nearbyTotal}
            ghostMode={ghostMode}
            glowColorByFriendId={glowColorByFriendId}
            reducedMotion={reducedMotion}
            loaded={nearbyLoaded}
            /* The server already resolved this. While the client list is still
               empty and the server found somebody, the section waits rather
               than claiming the room is empty. */
            soloActions={soloNearbyActions}
            focusedId={relationshipFocus?.muddy.id ?? null}
            onSelect={setSelectedFriendId}
          />
        ) : null}

        {/* Top Events (Ranked Events Discovery).

            Sits AFTER the Smart Card and Near, not above them. The brief's
            target order put Events directly under the hero, but the audit
            found Near carries the viewer's own live state (who is around
            them right now) and the Smart Card can be a live Safe Arrival
            journey. Discovery is not allowed to push either of those below
            the fold, so Events takes the next slot instead -- still high,
            still above the fold on a phone once the hero is compact, and
            without burying personal or safety state to get there.

            Renders nothing when the ranking is empty. */}

        {/* Trending Events sit ABOVE My Plans. What the wider community is
            doing is discovery -- it earns the higher slot because it is the
            thing you do not already know about. My Plans is a reminder of
            commitments you made yourself, so it reads better after. */}
        {/* Discovery does not outrank a first relationship. Somebody who has
            just added their first Muddy is pointed at the core loop, not at
            what the wider community is doing. */}
        {composition.showTrending ? <TopEventsHome events={topEvents} /> : null}

        {/* Upcoming Plans sits directly under Near: both answer "what is
            happening with my people", so they belong together, above the
            generic action shortcuts.

            The SAME stack Linkr uses, rather than a second plan presentation:
            two components showing the same projection would drift, and a plan
            that looks different depending on which screen you found it on is
            a plan you have to re-read. "See all" stays here only — Linkr IS
            the discovery page, so it has nowhere to send you. */}
        {agendaItems.length > 0 ? (
          <section aria-labelledby="home-plans-heading" data-tour-id={TOUR_TARGET_IDS.HOME_UPCOMING_PLAN}>
            <PageSectionHeader
              id="home-plans-heading"
              title="My Plans"
              href="/plans"
              actionAriaLabel="See all plans"
            />
            <PlanStack plans={agendaItems} onJoin={joinPlan} pending={isPending} />
          </section>
        ) : composition.showPlansEmpty ? (
          /* REAL PLANS ALWAYS SHOW; only the placeholder yields.
           *
           * The branch above is untouched on purpose -- being new is not a
           * reason to forget something you agreed to, and hiding a commitment
           * to tidy a screen would destroy information somebody is relying on.
           * "No plans yet" is an absence dressed as a module, and it has no
           * business competing with the one thing activation is asking for. */
          <UpcomingPlanEmpty />
        ) : null}


        {/* ONE next step, not a feature catalogue.
            "Suggestions for you" showed UpFor, Invite Friends and Find Muddies
            at equal weight, which reads as "here are three features" rather
            than "here is what would help". While somebody is still finding
            their feet, exactly one appears — and null is a legitimate answer:
            whitespace beats a filler card. */}
        {nextStep ? <NextForYou step={nextStep} /> : null}

        {/* Quick actions: first-time activation set, or the returning-user set.

            The first-time set (UpFor, Invite, Find Muddies) is KEPT during
            activation -- it points at the same goal the card does, so it
            reinforces rather than competes. Only the generic returning-user
            rail stands down, because "Suggestions for you" alongside a single
            clear next step is the screen offering two answers at once. */}
        {isFirstTimeUser ? (
          /* UpFor is filtered out until Glow has happened -- it describes
             letting Muddies know you are free, which needs somebody able to
             see you. Invite and Find Muddies remain: they grow the circle,
             which points the same way as the card above. */
          <FirstTimeQuickActions
            hiddenHrefs={[...hiddenQuickActionHrefs, ...earlyActivationHiddenActionHrefs(compositionInputs)]}
          />
        ) : composition.showSuggestions ? (
          <QuickActionsHome primary={primaryActions} />
        ) : null}

        {/* Moments preview. Renders the branded onboarding when the viewer has
            none, and the rail once any exist — so the onboarding is never
            shown again after a first Moment. */}
        {/* Moments paused: the section disappears entirely rather than
            leaving its onboarding card, which would be a creation affordance
            for a feature that is switched off. Home's remaining sections
            simply close up -- no filler was added in its place. */}
        {momentsEnabled && composition.showMoments ? (
          <MomentsPreview moments={moments} air={air} />
        ) : null}

        {/* Compact profile-completion banner (real state, dismissible).

            Filling in a profile is setup, not value. While activation is asking
            for one specific thing, a second ask for something different is the
            screen changing its mind. */}
        {profileReminder && composition.showProfileReminder ? (
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

        {/* Fills leftover space above the bottom nav with secondary shortcuts.
            Only for the returning-user action set; the first-time set is fixed. */}
        {!isFirstTimeUser && composition.showSuggestions ? (
          <HomeGapFillerActions pool={secondaryActions} />
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
  soloActions,
  focusedId = null,
  onSelect
}: {
  friends: DashboardFriend[];
  total: number;
  ghostMode: boolean;
  glowColorByFriendId: Record<string, string>;
  reducedMotion: boolean;
  /** False until the first nearby fetch settles; drives the skeleton. */
  loaded?: boolean;
  /**
   * What the SERVER found at render time.
   *
   * The nearby list is fetched after mount, so a failed or slow response left
   * this section unable to tell "not answered yet" from "genuinely nobody" --
   * and it chose the second, telling somebody the room was empty while the
   * server had already found a Muddy in it.
   */
  /**
   * Contextual actions for the single-nearby hero, supplied by Home.
   *
   * Rendered rather than decided here: the deterministic engine already owns
   * what to offer, and a second opinion inside JSX is how two surfaces start
   * disagreeing about the same relationship.
   */
  soloActions?: ReactNode;
  /**
   * Which nearby Muddy leads, from the canonical relationship selector.
   *
   * Home does not rank people here: it asks the same selector every other
   * surface asks, so the hero is the relationship the product already
   * considers most relevant.
   */
  focusedId?: string | null;
  onSelect: (friendId: string) => void;
}) {
  // Over the cap, keep the three strongest and give the 4th slot to "+N".
  const overflow = total > NEARBY_MAX_POSITIONS;
  const shown = overflow ? friends.slice(0, NEARBY_MAX_POSITIONS - 1) : friends.slice(0, NEARBY_MAX_POSITIONS);
  const remaining = total - shown.length;
  /* ONE PERSON LEADS, WHATEVER THE COUNT.
   *
   * With two nearby Muddies the rail gave both identical 76px cells and no
   * action, so a live social moment read as a directory. Home picks the same
   * relationship the rest of the product already focuses on -- `focusedId`
   * comes from the canonical selector -- and the others stay visible beneath
   * at lower weight rather than competing for the same attention.
   *
   * Falls back to the first result only when the selector has no opinion, so
   * the hero can never be empty while somebody is genuinely nearby. */
  const heroFriend = friends.length > 0 ? friends.find((f) => f.friendId === focusedId) ?? friends[0] : null;
  /* Everyone else, capped. Home is not the nearby directory -- /friends is. */
  const supporting = heroFriend
    ? friends.filter((f) => f.friendId !== heroFriend.friendId).slice(0, NEARBY_SUPPORTING_LIMIT)
    : [];
  /* Genuinely hidden people, not merely "more than one". Two visible Muddies
     beside a "See all" was an offer to expand what was already expanded. */
  const hiddenCount = total - (heroFriend ? 1 : 0) - supporting.length;

  return (
    // data-tour-id is the guided tour's stable targeting contract; the tour
    // spotlights this real section rather than showing a screenshot of it.
    <section aria-labelledby="home-nearby-heading" data-tour-id={TOUR_TARGET_IDS.HOME_NEARBY}>
      {/* Generous space above and below: this is the signature section, and
          the air around it is what stops it reading as a contact list. */}
      <PageSectionHeader
        id="home-nearby-heading"
        title="Near"
        /* "See all" only when somebody is genuinely HIDDEN.
           `total > 1` still offered to expand two people who were both already
           on screen -- a link to what you are looking at. */
        href={hiddenCount > 0 ? "/friends" : undefined}
        actionAriaLabel={`See all ${total} nearby Muddies`}
      />

      {/* Skeletons ONLY while the state is genuinely unknown.
          The previous guard also waited on `serverNearbyCount > 0`, which had
          no exit: once the client list settled empty the skeleton was
          permanent, and Home showed anonymous placeholders forever. The real
          answer was to stop starting from zero -- `friends` is now seeded with
          the server's own safe result, so "empty and not yet loaded" means
          nobody knew anything, which is the only honest reason to wait. */}
      {total === 0 && !loaded ? (
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
      ) : heroFriend ? (
        /* ONE PERSON IS THE EVENT, NOT A LIST ITEM.
         *
         * A genuine nearby Muddy is the moment the whole product exists for,
         * and it was rendering as a 76px cell in a scroll rail with a "See
         * all" beside it -- the same treatment four people get, so one person
         * read as a list that had mostly failed to load.
         *
         * Same components, same tokens, more room: the Glow does the talking,
         * the name is legible, and the action is right there instead of behind
         * a tap into a modal. */
        <div className="flex flex-col items-center gap-3 py-2 text-center">
          <button
            type="button"
            onClick={() => onSelect(heroFriend.friendId)}
            className="focus-ring safe-motion rounded-[1.5rem] p-1 transition-transform active:scale-[0.99] motion-reduce:active:scale-100"
            /* THE FULL NAME, even though the label below shows only the first.
             *
             * The visible text is first-name because Home is a greeting
             * surface and the card is narrow. An accessible name has neither
             * constraint, and a first name alone is ambiguous the moment a
             * user has two Muddies who share one -- which in Accra, where
             * "Kofi" and "Kwame" are among the commonest given names, is
             * ordinary rather than exotic. Sighted users disambiguate by
             * avatar; a screen reader user gets only this string
             * (MB-GOD-045). */
            aria-label={`${heroFriend.displayName || heroFriend.username}, ${proximityBandLabel(heroFriend.proximityBand)}. Open profile`}
          >
            <span className="relative grid place-items-center">
              <ProximityGlowAvatar
                name={heroFriend.displayName || heroFriend.username}
                src={heroFriend.avatarUrl}
                band={heroFriend.proximityBand}
                decorative
                glowColorId={glowColorByFriendId[heroFriend.friendId] ?? null}
                membershipTier={heroFriend.membershipTier}
                /* The one size difference. Proximity, strength and confidence
                   are untouched, so the band this renders is the band the
                   server resolved -- only the stage is bigger. */
                size="lg"
                reducedMotion={reducedMotion}
              />
            </span>
          </button>

          <span className="flex flex-col items-center gap-1">
            <span className="text-lg font-semibold leading-tight">
              {capitalize(firstName(heroFriend.displayName || heroFriend.username))}
            </span>
            {/* Canonical wording, never a measurement. The dot repeats what the
                label already says, so the label carries it alone here. */}
            <span className="text-sm font-medium text-muted-foreground">
              {proximityBandLabel(heroFriend.proximityBand)}
            </span>
          </span>

          {soloActions}

          {/* ALSO CLOSE — present, deliberately quieter.
              Relationship vocabulary, not discovery: these are Muddies, so
              never "people nearby" or "other users". Each row carries the same
              canonical proximity label and opens the same profile the hero
              does; no second Say hi is offered, because asking somebody to
              greet two new people at once is homework, not a moment. */}
          {supporting.length > 0 ? (
            <div className="mt-4 w-full">
              <p className="text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Also close
              </p>
              <ul className="mt-2 flex flex-col gap-1">
                {supporting.map((friend) => {
                  const name = capitalize(firstName(friend.displayName || friend.username));
                  // Visible text stays first-name; the accessible name does
                  // not truncate (MB-GOD-045).
                  const fullName = friend.displayName || friend.username;
                  return (
                    <li key={friend.friendId}>
                      <button
                        type="button"
                        onClick={() => onSelect(friend.friendId)}
                        className="focus-ring safe-motion flex w-full items-center gap-3 rounded-2xl px-1 py-1.5 text-left transition-transform active:scale-[0.99] motion-reduce:active:scale-100"
                        aria-label={`${fullName}, ${proximityBandLabel(friend.proximityBand)}. Open profile`}
                      >
                        <ProximityGlowAvatar
                          name={friend.displayName || friend.username}
                          src={friend.avatarUrl}
                          band={friend.proximityBand}
                          decorative
                          glowColorId={glowColorByFriendId[friend.friendId] ?? null}
                          membershipTier={friend.membershipTier}
                          size="sm"
                          reducedMotion={reducedMotion}
                          intensity={NEAR_GLOW_INTENSITY}
                        />
                        <span className="min-w-0 flex-1 truncate text-sm font-medium">{name}</span>
                        <span className="shrink-0 text-xs font-medium text-muted-foreground">
                          {proximityBandLabel(friend.proximityBand)}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}
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
                /* Full name for assistive technology; the 4.75rem column below
                   still shows only the first (MB-GOD-045). */
                aria-label={`${friend.displayName || friend.username}, ${proximityBandLabel(friend.proximityBand)}`}
              >
                {/* Fixed-height avatar slot. The halo's padding varies with
                    proximity, so without a fixed box each column would be a
                    slightly different height and the names and distance labels
                    would sit at different baselines across the row. */}
                <span className="relative grid h-[4.5rem] w-full place-items-center">
                  <ProximityGlowAvatar
                    name={name}
                    src={friend.avatarUrl}
                    band={friend.proximityBand}
                    decorative
                    glowColorId={glowColorByFriendId[friend.friendId] ?? null}
                    // Identity, independent of the proximity prop above:
                    // ProximityGlow owns the distance aura, UserAvatar owns the
                    // membership band. Neither reads the other's inputs.
                    membershipTier={friend.membershipTier}
                    size="md"
                    reducedMotion={reducedMotion}
                    // Presentation only: a calmer aura on Home. The band is
                    // untouched, so the six-state ordering is preserved.
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
                  <span className="truncate">{proximityBandLabel(friend.proximityBand)}</span>
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
  { href: "/hangout-mode", label: "UpFor", description: "Let your Muddies know you are free right now.", suggestion: "See who is up for something.", tone: "orange", icon: Hand, featureIcon: "hangout", accent: "text-primary" },
  { href: "/invites", label: "Invite Friends", description: "Invite people you already know.", suggestion: "Grow your trusted circle.", tone: "lavender", icon: UserPlus, featureIcon: "invites", accent: "text-violet-500 dark:text-violet-400" },
  { href: "/friends?tab=add", label: "Find Muddies", description: "Search for people on Mad Buddy.", suggestion: "Find people you already know.", tone: "blue", icon: Search, featureIcon: "socialize", accent: "text-sky-500 dark:text-sky-400" }
];

function FirstTimeQuickActions({ hiddenHrefs = [] }: { hiddenHrefs?: string[] }) {
  // Same hidden-href list the returning-user rail already honours. Without
  // this, a paused feature keeps a first-run CTA pointing at it -- which is
  // the one rail every brand-new account sees.
  const actions = FIRST_TIME_ACTIONS.filter((action) => !hiddenHrefs.includes(action.href));
  return (
    <section aria-labelledby="home-actions-heading" data-tour-id={TOUR_TARGET_IDS.HOME_QUICK_ACTIONS}>
      {/* No action: the first-time set is the whole set, so there is nothing
          more to see. */}
      <PageSectionHeader id="home-actions-heading" title="Suggestions for you" />
      <div className="-mx-4 flex gap-2.5 overflow-x-auto px-4 pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:-mx-6 sm:px-6">
        {actions.map((action) => (
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
    edge: { a: "232 140 43", b: "251 113 133" }
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
  { href: "/hangout-mode", label: "UpFor", description: "Let your Muddies know you’re free right now.", suggestion: "See who is up for something.", tone: "orange", icon: Hand, featureIcon: "hangout", accent: "text-primary" },
  { href: "/invites", label: "Invite Friends", description: "Review and send invitations.", suggestion: "Grow your trusted circle.", tone: "lavender", icon: UserPlus, featureIcon: "invites", accent: "text-emerald-500 dark:text-emerald-400" },
  { href: "/friends?tab=add", label: "Find Muddies", description: "Search for people on Mad Buddy.", suggestion: "Find people you already know.", tone: "blue", icon: Search, featureIcon: "socialize", accent: "text-sky-500 dark:text-sky-400" },
  { href: "/plans?create=1", label: "Complete a Plan", description: "Create a plan and bring people together.", suggestion: "Bring people together.", tone: "green", icon: CalendarDays, featureIcon: "plans", accent: "text-emerald-500 dark:text-emerald-400" },
  { href: "/events", label: "Discover Events", description: "See what’s coming up.", suggestion: "See what’s happening nearby.", tone: "blue", icon: PartyPopper, featureIcon: "events", accent: "text-violet-500 dark:text-violet-400" },
  { href: "/discover", label: "Linkr", description: "Find people who are open to connecting.", suggestion: "Meet people open to connecting.", tone: "lavender", icon: Compass, featureIcon: "socialize", accent: "text-violet-500 dark:text-violet-400" },
  { href: "/safe-arrival", label: "Safe Arrival", description: "Let trusted Muddies know when you arrive safely.", suggestion: "Let your circle know you got there.", tone: "blue", icon: ShieldCheck, featureIcon: "safeArrival", accent: "text-sky-500 dark:text-sky-400" },
  { href: "/groups", label: "Circles", description: "Open your Circles and invitations.", suggestion: "Catch up with your Circles.", tone: "green", icon: Users2, featureIcon: "groups", accent: "text-sky-500 dark:text-sky-400" },
  { href: "/reminders", label: "Reminders", description: "Reminders for plans and connections.", suggestion: "Stay on top of what’s next.", tone: "orange", icon: Bell, featureIcon: "reminders", accent: "text-amber-500 dark:text-amber-400" },
  { href: "/settings/engagement", label: "Focus", description: "Manage Focus Mode and notification limits.", suggestion: "Quieten things down for a while.", tone: "blush", icon: Moon, featureIcon: "focus", accent: "text-pink-500 dark:text-pink-400" }
];

/**
 * The suggestions surfaced on the Home rail, in order. The rest stay
 * available through "More to explore" lower down.
 */
const PRIMARY_ACTION_HREFS = ["/hangout-mode", "/invites", "/friends?tab=add"];

/** How many suggestions the Home rail renders before the rest fall through. */
const SUGGESTION_COUNT = 3;

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
function QuickActionsHome({ primary }: { primary: QuickAction[] }) {
  const railRef = useRef<HTMLDivElement>(null);
  // One shared controller for the whole rail, not a timer per card. Pauses
  // while the rail is being touched or scrolled, or while the tab is hidden.
  const railBusy = useInteractionPause(railRef);
  const sweepingIndex = useSequenceHighlight(primary.length, { paused: railBusy });

  // No suggestions available (every feature flagged off) — hide the section
  // rather than render an empty placeholder.
  if (primary.length === 0) return null;

  return (
    <section aria-labelledby="home-actions-heading" data-tour-id={TOUR_TARGET_IDS.HOME_QUICK_ACTIONS}>
      {/* No See all action: there is no canonical Suggestions destination. */}
      <PageSectionHeader id="home-actions-heading" title="Suggestions for you" />

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

    </section>
  );
}

/**
 * One suggestion. A calm pastel surface, a small rounded icon chip, a title
 * and one short sentence — closer to a widget than a shortcut button.
 */
/**
 * The single next step, for somebody still finding their feet.
 *
 * REUSES THE EXISTING CARD, deliberately. A bespoke card here would be a
 * second visual language for the same job, and the rail's own card already
 * carries the tone, icon and touch target this needs. Only the count changes:
 * one, chosen by rule, instead of three shown together.
 *
 * The heading says "Next for you" rather than "Suggestions for you" because a
 * single deliberate step is not a list of suggestions to browse.
 */
/**
 * The one next step, resolved against real state.
 *
 * Say hi carries a REAL NAME, so it cannot live in a static table: "Say hi to
 * Ama" is the whole point -- naming the person is what makes it a relationship
 * action rather than a feature suggestion.
 */
type NextStepView = {
  href: Route;
  label: string;
  description: string;
  icon: typeof UserPlus;
  /** Stable identity for the future Contextual Guidance System. */
  actionId: string;
};

function resolveNextStep(
  action: Exclude<NextBestAction, null>,
  muddy: { displayName: string } | null
): NextStepView | null {
  if (action === "say_hi_to_muddy") {
    // No name, no card: never "Say hi to your Muddy".
    if (!muddy) return null;
    return {
      href: "/friends" as Route,
      label: `Say hi to ${muddy.displayName}`,
      description: "You haven't chatted yet.",
      icon: MessageCircle,
      actionId: "say_hi_to_muddy"
    };
  }
  /* SPECIFIC, so it does not restate the header.
     The header's person-plus goes to /friends?tab=requests -- a generic "Add
     Muddy" entry that also carries the pending-request badge. This is the
     narrower job: bringing somebody who is not on Mad Buddy yet. */
  return {
    href: "/invites" as Route,
    label: "Invite another Muddy",
    description: "Grow your circle with someone you already know.",
    icon: UserPlus,
    actionId: "invite_muddy"
  };
}

function NextForYou({ step }: { step: NextStepView }) {
  const Icon = step.icon;

  return (
    <section aria-labelledby="home-next-heading">
      {/* "Next step", not "Next for you".
          The second reads as recommendation-feed language -- the vocabulary of
          things picked FOR you to browse. This is one deliberate step to
          continue with, so it is named as a step. */}
      <PageSectionHeader id="home-next-heading" title="Next step" />

      {/* A ROW, NOT A LONELY TILE.
          SuggestionCard is a fixed 7.75rem rail card, sized so three fit with a
          fourth peeking. Rendering one left two thirds of the row empty, which
          read as "two cards failed to load" rather than "this is the step".
          Full width, compact height, one line of support, one chevron. */}
      <Link
        href={step.href}
        aria-label={`${step.label}. ${step.description}`}
        // Stable identity for the future Contextual Guidance System to
        // spotlight. No tooltip today -- just something durable to point at.
        data-home-action={step.actionId}
        className="focus-ring safe-motion mt-2 flex items-center gap-3.5 rounded-[1.25rem] border border-border/70 bg-card/60 px-4 py-3.5 transition-[transform,box-shadow] active:scale-[0.99] motion-reduce:transition-none motion-reduce:active:scale-100"
      >
        {/* Restrained accent: the orange relationship CTA above stays the
            strongest thing on the screen. */}
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-secondary/70 text-primary">
          <Icon className="h-[18px] w-[18px]" strokeWidth={1.75} aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold leading-tight">{step.label}</span>
          {/* One line. Wraps rather than truncating, so the meaning survives
              large text instead of disappearing behind an ellipsis. */}
          <span className="mt-0.5 block text-[0.8125rem] leading-snug text-muted-foreground">
            {step.description}
          </span>
        </span>
        <ChevronRight
          className="h-4 w-4 shrink-0 text-muted-foreground"
          strokeWidth={1.75}
          aria-hidden="true"
        />
      </Link>
    </section>
  );
}

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
 * the count drops. Primary suggestions are excluded from this pool, so nothing
 * is ever listed twice.
 *
 * The measurement uses this element's own document offset, which does NOT
 * depend on how many tiles it renders, so growing the filler can't feed back
 * into the measurement and oscillate.
 */
function HomeGapFillerActions({ pool }: { pool: QuickAction[] }) {
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

/**
 * Shown in place of the card when there is nothing coming up. Deliberately a
 * light invitation rather than an empty card, matching the Near section's
 * treatment.
 */
function UpcomingPlanEmpty() {
  return (
    <section aria-labelledby="home-plan-heading">
      {/* No action: with nothing upcoming there is nothing to see all of. */}
      <PageSectionHeader id="home-plan-heading" title="My Plans" />
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
  // No trailing full stop: this is now the page heading rather than a
  // sentence under one, and headings do not end in punctuation.
  return name ? `${partOfDay}, ${name}` : partOfDay;
}

function toDashboardFriend(friend: NearbyFriendApiItem): DashboardFriend {
  return {
    friendId: friend.friend_id,
    displayName: friend.display_name,
    username: friend.username,
    avatarUrl: friend.avatar_url,
    proximityLevel: friend.proximity_level,
    // Presentation band, straight through. Never re-derived on the client:
    // the client has no distance to derive it from, and must not.
    proximityBand: friend.proximity_band ?? "outside_range",
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
