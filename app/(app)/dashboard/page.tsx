import { DashboardPageContent } from "@/components/dashboard/dashboard-page";
import { getCurrentSubscriptionAccess } from "@/lib/premium/access";
import { ensureProfileForUser } from "@/lib/profiles/ensure-profile";
import { loadSafeArrival } from "@/lib/safety/safe-arrival-mobile";
import { loadUpcomingPlans } from "@/lib/social/upcoming-plans";
import { getCurrentUser } from "@/lib/supabase/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";

function isStatusActiveAtRequestTime(expiresAt: string) {
  return Date.parse(expiresAt) > Date.now();
}

export default async function DashboardPage() {
  // Shares the per-request cached getUser() with the layout; the client is for
  // this page's own queries.
  const [supabase, user] = await Promise.all([createSupabaseServerClient(), getCurrentUser()]);
  const [access, profile, statusResult, upcoming, profileDetailsResult, safeArrival, glowColorsResult] = user
    ? await Promise.all([
        getCurrentSubscriptionAccess(user.id),
        ensureProfileForUser(user),
        supabase
          .from("user_statuses")
          .select("availability_type, activity_type, custom_text, expires_at")
          .eq("user_id", user.id)
          .maybeSingle(),
        loadUpcomingPlans(user.id),
        supabase
          .from("profiles")
          .select("avatar_url, bio, mood_status")
          .eq("user_id", user.id)
          .maybeSingle(),
        loadSafeArrival(user.id),
        supabase
          .from("friend_glow_colors")
          .select("friend_id, color_id")
          .eq("owner_id", user.id)
      ])
    : [null, null, null, { plans: [], hasMore: false }, null, null, null];

  const status = statusResult?.data;
  const hasActiveStatus = Boolean(status && isStatusActiveAtRequestTime(status.expires_at));
  const profileDetails = profileDetailsResult?.data;
  const glowColorByFriendId = Object.fromEntries(
    (glowColorsResult?.data ?? []).map((row) => [row.friend_id, row.color_id])
  );
  const missingProfileItems = profileDetails
    ? [
        !profileDetails.avatar_url ? "photo" : null,
        !profileDetails.bio?.trim() ? "short bio" : null,
        !profileDetails.mood_status?.trim() ? "mood" : null
      ].filter((item): item is string => Boolean(item))
    : [];

  return (
    <DashboardPageContent
      subscriptionPlan={access?.plan}
      hasPremium={access?.hasPremium}
      initialVisibilityStatus={profile?.visibility_status ?? "visible"}
      displayName={profile?.full_name?.split(" ")[0] || ""}
      hasActiveStatus={hasActiveStatus}
      initialStatusAvailability={hasActiveStatus ? status?.availability_type : undefined}
      initialStatusActivity={hasActiveStatus ? status?.activity_type ?? null : null}
      initialStatusNote={hasActiveStatus ? status?.custom_text ?? "" : ""}
      upcomingPlans={upcoming?.plans ?? []}
      hasMorePlans={upcoming?.hasMore ?? false}
      glowColorByFriendId={glowColorByFriendId}
      safeArrivalSession={
        safeArrival?.mySessions[0] ??
        safeArrival?.watching.find((item) => item.myAcknowledgement === "watching") ??
        null
      }
      profileReminder={
        user && missingProfileItems.length > 0
          ? { userId: user.id, missingItems: missingProfileItems }
          : null
      }
    />
  );
}
