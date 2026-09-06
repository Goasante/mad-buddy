import { DashboardPageContent } from "@/components/dashboard/dashboard-page";
import { loadActivationProjection } from "@/lib/activation/projection";
import { loadFriendGlowColors } from "@/lib/glow/custom-colors-server";
import { ensureProfileForUser } from "@/lib/profiles/ensure-profile";
import { loadSafeArrivalJourneys } from "@/lib/safety/safe-arrival-service";
import { loadUpcomingAgenda } from "@/lib/social/upcoming-agenda";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/supabase/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isMomentsEnabled, isSocializeEnabled } from "@/lib/features/feature-flags";
import { countIncomingRequests } from "@/lib/friends/service";
import { loadJourney } from "@/lib/journey/journey-service";
import { isFirstTimeJourneyState } from "@/lib/journey/journey";
import { loadBuddyScore } from "@/lib/engagement/buddy-score-service";
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
  const [profile, statusResult, agenda, profileDetailsResult, safeArrival, glowColorByFriendId, socializeEnabled, momentsEnabled, journey, incomingRequestCount, birthDetailsResult, buddyScore, moments, air, topEvents, activation] = user
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
        loadActivationProjection(user.id)
      ])
    : [null, null, { items: [], hasMore: false }, null, null, {}, false, false, null, 0, null, null, [], [], [], null];

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
              (item) => item.kind === "plan" && isWeekendPlanningWindow(new Date(item.startAt))
            ).length
          : 0,
        nearbyFriends: activation?.nearby ?? [],
        locationFreshForProximity: activation?.locationFreshForProximity ?? false,
        muddyCount: activation?.muddyCount ?? 0,
        buddyScore,
        recentAchievement: null,
        suggestionCount: 0
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
