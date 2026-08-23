import { DashboardPageContent } from "@/components/dashboard/dashboard-page";
import { loadActivationProjection } from "@/lib/activation/projection";
import { loadFriendGlowColors } from "@/lib/glow/custom-colors-server";
import { getCurrentSubscriptionAccess } from "@/lib/premium/access";
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
 */
const HOME_MOMENTS_LIMIT = 8;

function isStatusActiveAtRequestTime(expiresAt: string) {
  return Date.parse(expiresAt) > Date.now();
}

export default async function DashboardPage() {
  // Shares the per-request cached getUser() with the layout; the client is for
  // this page's own queries.
  const [supabase, user] = await Promise.all([createSupabaseServerClient(), getCurrentUser()]);
  const admin = createSupabaseAdminClient();
  const [access, profile, statusResult, agenda, profileDetailsResult, safeArrival, glowColorByFriendId, socializeEnabled, momentsEnabled, journey, incomingRequestCount, birthDetailsResult, buddyScore, moments, air, topEvents, activation] = user
    ? await Promise.all([
        getCurrentSubscriptionAccess(user.id),
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
        // The Buddy Score LEVEL load that used to sit here is gone: the
        // authed layout now resolves it once for the shared menu sheet, so
        // loading it again here would query the same ledger twice per
        // navigation. The full score below is a different read (it carries
        // nextLevel/pointsToNext for the Smart Card) and stays.
        // Pending INCOMING Muddy requests only — the Add Muddy badge.
        countIncomingRequests(user.id),
        // Own date of birth, for the Smart Card birthday state. Never another
        // user's — this is the viewer's own row, read with the admin client
        // exactly as the rest of this page's own-profile reads are.
        admin.from("profile_birth_details").select("date_of_birth").eq("user_id", user.id).maybeSingle(),
        // Full score (not just the level label) for the Buddy Progress card,
        // which needs nextLevel/pointsToNext/progressPercent.
        loadBuddyScore(admin, user.id),
        // The canonical Moments feed, same loader and same authorisation the
        // Moments page uses. Home renders a capped preview of it (see
        // HOME_MOMENTS_LIMIT below) rather than the whole feed.
        buildMomentFeed(admin, user.id),
        // Air sessions, mixed into the same rail as Moments (no section
        // labels on Home). Same canonical loader the Moments page uses.
        buildSpotlightFeed(admin, user.id),
        // Top 5 ONLY (Ranked Events Discovery). Home never loads the full
        // ranking: the ranked page asks the same loader for up to 100, so
        // the two agree on rank without Home paying for 100 rows.
        getRankedUpcomingEvents(user.id, { limit: HOME_RANKED_EVENTS_LIMIT }),
        // What this person needs next, derived from their real situation.
        // Batched with everything else, so Home costs no extra round trip.
        loadActivationProjection(user.id)
      ])
    : [null, null, null, { items: [], hasMore: false }, null, null, {}, false, false, null, 0, null, null, [], [], [], null];

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

  // The one Smart Card Home renders. Composed from data this page already
  // loaded rather than re-querying it: the engine is a pure selection over
  // that batch plus one small acknowledgement read.
  const now = new Date();
  const dateOfBirth = birthDetailsResult?.data?.date_of_birth ?? null;
  const smartCard = user
    ? await loadSmartCard(user.id, {
        now,
        journey,
        safeArrival: safeArrival
          ? {
              travelling: safeArrival.travelling.length > 0,
              // acceptedCount, not contacts.length: the visible contact list
              // is privacy-filtered and can be shorter than the real number
              // of people actually checking in.
              watcherCount: safeArrival.travelling[0]?.acceptedCount ?? 0
            }
          : null,
        birthday: dateOfBirth
          ? deriveBirthProfile(dateOfBirth, now.toISOString().slice(0, 10))
          : null,
        // Plans already starting inside the weekend window, so the weekend
        // card can say "your weekend is filling up" rather than guessing.
        weekendPlanCount: isWeekendPlanningWindow(now)
          ? (agenda?.items ?? []).filter(
              (item) => item.kind === "plan" && isWeekendPlanningWindow(new Date(item.startAt))
            ).length
          : 0,
        // Nearby is fetched client-side after mount, so the server cannot know
        // the live count. The nearby card therefore only claims a Muddy is
        // close when the server can prove it — which today it cannot, so it
        // declines rather than showing a number that might be wrong.
        nearbyCount: 0,
        hasPremium: Boolean(access?.hasPremium),
        buddyScore,
        // No acknowledged-achievement projection exists yet; the provider
        // declines rather than re-surfacing an old badge on every visit.
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
      subscriptionPlan={access?.plan}
      hasPremium={access?.hasPremium}
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
              // Accepted only: an unanswered invite belongs in `invitations`,
              // where it is still actionable, not in the accepted list.
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
      // Preview only — the rail shows a handful, /moments owns the full feed.
      moments={(moments ?? []).slice(0, HOME_MOMENTS_LIMIT)}
      // Mixed into the same rail, capped alongside Moments.
      air={(air ?? []).slice(0, HOME_MOMENTS_LIMIT)}
      topEvents={topEvents ?? []}
      isFirstTimeUser={journey ? isFirstTimeJourneyState(journey) : false}
      incomingRequestCount={incomingRequestCount ?? 0}
    />
  );
}
