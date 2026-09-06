import { DashboardPageContent } from "@/components/dashboard/dashboard-page";
import { loadActivationProjection } from "@/lib/activation/projection";
import { loadFriendGlowColors } from "@/lib/glow/custom-colors-server";
import { ensureProfileForUser } from "@/lib/profiles/ensure-profile";
import { loadSafeArrivalJourneys } from "@/lib/safety/safe-arrival-service";
import { loadClickedPeople } from "@/lib/linkr/collections-service";
import { loadHomeUpForContext } from "@/lib/social/home-upfor-context";
import { loadUpcomingAgenda } from "@/lib/social/upcoming-agenda";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/supabase/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isMomentsEnabled, isSocializeEnabled } from "@/lib/features/feature-flags";
import { countIncomingRequests } from "@/lib/friends/service";
import { loadJourney } from "@/lib/journey/journey-service";
import { isFirstTimeJourneyState } from "@/lib/journey/journey";
import { loadBuddyScore } from "@/lib/engagement/buddy-score-service";
import { HOME_EXCLUDED_SMART_CARD_IDS } from "@/lib/smart-card/home-gate";
import { loadHomeSmartCardProjection } from "@/lib/smart-card/home-projection";
import { loadSmartCard } from "@/lib/smart-card/smart-card-service";
import { deriveBirthProfile } from "@/lib/profile/birth-date";
import { isWeekendPlanningWindow } from "@/lib/smart-card/smart-card";
import { buildMomentFeed, buildSpotlightFeed } from "@/lib/content/service";
import { getRankedUpcomingEvents } from "@/lib/events/ranked-events";
import { HOME_RANKED_EVENTS_LIMIT } from "@/lib/events/ranking";

/**
 * How many Moments the Home rail renders. Enough to fill the viewport with
 * one peeking; the full feed lives on /moments.
 *
 * Moments is paused as a Smart Card source. This legacy Home rail remains
 * governed by its feature flag until the separate Moments cleanup tranche.
 */
const HOME_MOMENTS_LIMIT = 8;

function isStatusActiveAtRequestTime(expiresAt: string) {
  return Date.parse(expiresAt) > Date.now();
}

export default async function DashboardPage() {
  const [supabase, user] = await Promise.all([createSupabaseServerClient(), getCurrentUser()]);
  const admin = createSupabaseAdminClient();
  const [profile, statusResult, agenda, profileDetailsResult, safeArrival, glowColorByFriendId, socializeEnabled, momentsEnabled, journey, incomingRequestCount, birthDetailsResult, buddyScore, moments, air, topEvents, activation, upForContext, linkrMutuals] = user
    ? await Promise.all([
        ensureProfileForUser(user),
        supabase
          .from("user_statuses")
          .select("availability_type, activity_type, custom_text, expires_at")
          .eq("user_id", user.id)
          .maybeSingle(),
        loadUpcomingAgenda(user.id, 8),
        supabase
          .from("profiles")
          .select("username, avatar_url, bio, mood_status")
          .eq("user_id", user.id)
          .maybeSingle(),
        loadSafeArrivalJourneys(admin, user.id),
        loadFriendGlowColors(admin, user.id),
        isSocializeEnabled(admin),
        isMomentsEnabled(admin),
        loadJourney(admin, user.id),
        countIncomingRequests(user.id),
        admin.from("profile_birth_details").select("date_of_birth").eq("user_id", user.id).maybeSingle(),
        loadBuddyScore(admin, user.id),
        buildMomentFeed(admin, user.id),
        buildSpotlightFeed(admin, user.id),
        getRankedUpcomingEvents(user.id, { limit: HOME_RANKED_EVENTS_LIMIT }),
        loadActivationProjection(user.id),
        loadHomeUpForContext(admin, user.id),
        loadClickedPeople(user.id)
      ])
    : [null, null, { items: [], hasMore: false }, null, null, {}, false, false, null, 0, null, null, [], [], [], null, null, []];

  const status = statusResult?.data;
  const hasActiveStatus = Boolean(status && isStatusActiveAtRequestTime(status.expires_at));
  const profileDetails = profileDetailsResult?.data;
  const missingProfileItems = profileDetails
    ? [
        !profileDetails.avatar_url ? "photo" : null,
        !profileDetails.bio?.trim() ? "short bio" : null,
        !profileDetails.mood_status?.trim() ? "mood" : null
      ].filter((item): item is string => Boolean(item))
    : [];

  /**
   * One Smart Card, now fed by the SAME canonical projections Home already
   * owns. No duplicate Plan/Event/proximity queries are introduced here.
   *
   * Important privacy invariant: proximity arrives through activation.nearby,
   * the SafeNearbyFriend projection (bands only, never coordinates/distance),
   * and is paired with the viewer-location freshness fact. The provider can
   * therefore refuse stale proximity rather than making a current-sounding
   * claim from old data.
   */
  const now = new Date();
  const dateOfBirth = birthDetailsResult?.data?.date_of_birth ?? null;

  /**
   * The newer Smart Card facts, in ONE batch, BOUNDED BY THE AGENDA above.
   *
   * It runs after the main batch rather than inside it because the decision
   * readers take the Plans Home has already loaded and already permission
   * filtered. Passing those ids in is what keeps this bounded: the projection
   * never discovers Plans of its own, so it cannot reach one the viewer
   * cannot see, and it asks about a handful of Plans rather than all of them.
   *
   * Fails closed as a whole. If it yields nothing, Home still renders its
   * Smart Card from the states that were already proven.
   */
  const agendaPlans = (agenda?.items ?? []).filter((item) => item.kind === "plan");
  const smartCardProjection = user
    ? await loadHomeSmartCardProjection({
        userId: user.id,
        planIds: agendaPlans.map((plan) => plan.id),
        planTitleById: new Map(agendaPlans.map((plan) => [plan.id, plan.title])),
        now
      })
    : null;

  const smartCard = user
    ? await loadSmartCard(user.id, {
        now,
        journey,
        safeArrival: safeArrival
          ? {
              travelling: safeArrival.travelling.length > 0,
              watcherCount: safeArrival.travelling[0]?.acceptedCount ?? 0
            }
          : null,
        birthday: dateOfBirth
          ? deriveBirthProfile(dateOfBirth, now.toISOString().slice(0, 10))
          : null,
        agenda: agenda?.items ?? [],
        weekendPlanCount: isWeekendPlanningWindow(now)
          ? (agenda?.items ?? []).filter(
              /* `startsAt` is the agenda projection's field for both kinds.
                 A plan also carries `startAt` from HomeUpcomingPlan with the
                 same value, but reading the projection's own field keeps every
                 agenda consumer on one contract. */
              (item) => item.kind === "plan" && isWeekendPlanningWindow(new Date(item.startsAt))
            ).length
          : 0,
        nearbyFriends: activation?.nearby ?? [],
        locationFreshForProximity: activation?.locationFreshForProximity ?? false,
        muddyCount: activation?.muddyCount ?? 0,
        buddyScore,
        recentAchievement: null,
        suggestionCount: 0,
        upFor: upForContext,
        /* Both are facts Home already owns: the request count feeds its header
           badge, and Linkr mutuals are only ever MUTUAL matches, so a card
           built from them reveals nothing one-sided. */
        incomingRequestCount: incomingRequestCount ?? 0,
        linkrMutuals: linkrMutuals ?? [],
        /* Families 3-5. Each is a fact the projection above already bounded and
           already permission-checked; the providers stay pure and simply choose
           between what they are handed. */
        eventLinkrOffer: smartCardProjection?.eventLinkrOffer ?? null,
        muddyBirthdays: smartCardProjection?.muddyBirthdays ?? [],
        planDecisions: smartCardProjection?.planDecisions ?? [],
        planChatDecisions: smartCardProjection?.planChatDecisions ?? [],
        blockedFeature: smartCardProjection?.blockedFeature ?? null,
        /* ENTITLEMENT. Gates only states that would START something new, so an
           expired viewer keeps every existing Linkr mutual, UpFor commitment,
           Plan, conversation and safety state exactly as before. Absent means
           ungated: a failed entitlement read must never withhold someone's
           existing social life. */
        access: smartCardProjection?.access ?? null,
        /* NearbyHero owns the proximity payoff and the Activation card owns
           cold-start people discovery. Excluding them HERE (rather than after
           resolution) means that when one of them ranks highest the engine
           returns the next best Card B state instead of a card Home would
           decline to render. */
        excludedIds: HOME_EXCLUDED_SMART_CARD_IDS
      })
    : null;

  return (
    <DashboardPageContent
      activationState={activation?.state ?? null}
      firstMuddy={activation?.acknowledgeFirstMuddy ? activation.firstMuddy : null}
      firstMuddyNeedsLocation={activation ? !activation.locationGranted : false}
      activationMilestones={activation?.milestones ?? []}
      relationshipFocus={activation?.relationshipFocus ?? null}
      twoSidedConversationCount={activation?.twoSidedConversationCount ?? 0}
      unreadConversationCount={activation?.unreadConversationCount ?? 0}
      planParticipationCount={activation?.planParticipationCount ?? 0}
      muddyCount={activation?.muddyCount ?? 0}
      serverNearby={activation?.nearby ?? []}
      initialVisibilityStatus={profile?.visibility_status ?? "visible"}
      displayName={profile?.full_name?.split(" ")[0] || ""}
      hasActiveStatus={hasActiveStatus}
      initialStatusAvailability={hasActiveStatus ? status?.availability_type : undefined}
      initialStatusActivity={hasActiveStatus ? status?.activity_type ?? null : null}
      initialStatusNote={hasActiveStatus ? status?.custom_text ?? "" : ""}
      agendaItems={agenda?.items ?? []}
      glowColorByFriendId={glowColorByFriendId}
      safeArrival={
        safeArrival
          ? {
              travelling: safeArrival.travelling,
              checkingOn: safeArrival.checkingOn.filter((journey) => journey.myAcknowledgement === "accepted"),
              invitations: safeArrival.checkingOn.filter((journey) => journey.myAcknowledgement === "invited")
            }
          : null
      }
      profileReminder={
        user && missingProfileItems.length > 0
          ? { userId: user.id, missingItems: missingProfileItems }
          : null
      }
      hiddenQuickActionHrefs={[
        ...(socializeEnabled ? [] : ["/discover"]),
        ...(momentsEnabled ? [] : ["/moments"])
      ]}
      momentsEnabled={Boolean(momentsEnabled)}
      smartCard={smartCard}
      moments={(moments ?? []).slice(0, HOME_MOMENTS_LIMIT)}
      air={(air ?? []).slice(0, HOME_MOMENTS_LIMIT)}
      topEvents={topEvents ?? []}
      isFirstTimeUser={journey ? isFirstTimeJourneyState(journey) : false}
      incomingRequestCount={incomingRequestCount ?? 0}
    />
  );
}
