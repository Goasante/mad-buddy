import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { consumeRateLimit, rateLimitMessage } from "@/lib/security/rate-limit";

type ExportBundle = {
  exportedAt: string;
  account: {
    id: string;
    email: string | null;
  };
  data: Record<string, unknown>;
};

export async function GET() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error: userError
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const userId = user.id;
  const rateLimit = await consumeRateLimit({ action: "account.export", userId });
  if (!rateLimit.allowed) {
    return NextResponse.json({ error: rateLimitMessage(rateLimit.resetAt) }, { status: 429 });
  }
  const [
    profile,
    subscription,
    preferences,
    location,
    friendsOne,
    friendsTwo,
    sentRequests,
    receivedRequests,
    blockedByMe,
    blockingMe,
    notifications,
    reportsMade,
    reportsAboutMe,
    consentLogs,
    friendCircles,
    privacyZones,
    meetupRequestsSent,
    meetupRequestsReceived,
    bestBuddies,
    eventModes,
    appFeedback,
    supportRequests,
    mediaAssets
  ] = await Promise.all([
    supabase.from("profiles").select("user_id, full_name, username, avatar_url, bio, mood_status, visibility_status, onboarding_complete, created_at, updated_at").eq("user_id", userId).maybeSingle(),
    supabase.from("subscriptions").select("provider, plan, status, current_period_start, current_period_end, cancel_at_period_end, grace_ends_at, created_at, updated_at").eq("user_id", userId).maybeSingle(),
    supabase.from("user_preferences").select("user_id, notification_preferences, app_preferences, created_at, updated_at").eq("user_id", userId).maybeSingle(),
    supabase.from("user_locations").select("confidence, last_updated").eq("user_id", userId).maybeSingle(),
    supabase.from("friendships").select("*").eq("user_one_id", userId),
    supabase.from("friendships").select("*").eq("user_two_id", userId),
    supabase.from("friend_requests").select("*").eq("sender_id", userId),
    supabase.from("friend_requests").select("*").eq("receiver_id", userId),
    supabase.from("blocked_users").select("*").eq("blocker_id", userId),
    supabase.from("blocked_users").select("*").eq("blocked_id", userId),
    supabase.from("notifications").select("*").eq("user_id", userId).order("created_at", { ascending: false }),
    supabase.from("reports").select("*").eq("reporter_id", userId),
    supabase.from("reports").select("*").eq("reported_user_id", userId),
    supabase.from("consent_logs").select("*").eq("user_id", userId),
    supabase.from("friend_circles").select("*, circle_members(*)").eq("user_id", userId),
    supabase.from("privacy_zones").select("*").eq("user_id", userId),
    supabase.from("meetup_requests").select("*").eq("sender_id", userId),
    supabase.from("meetup_requests").select("*").eq("receiver_id", userId),
    supabase.from("best_buddies").select("*").eq("user_id", userId),
    supabase.from("event_modes").select("*").eq("user_id", userId),
    supabase.from("app_feedback").select("category, rating, message, status, created_at, updated_at").eq("user_id", userId),
    supabase.from("support_requests").select("full_name, email, message, status, created_at, updated_at").eq("user_id", userId),
    supabase.from("media_assets").select("id, content_type, size_bytes, context_type, processing_status, moderation_status, created_at, updated_at, deleted_at").eq("owner_id", userId)
  ]);

  const failed = [
    profile,
    subscription,
    preferences,
    location,
    friendsOne,
    friendsTwo,
    sentRequests,
    receivedRequests,
    blockedByMe,
    blockingMe,
    notifications,
    reportsMade,
    reportsAboutMe,
    consentLogs,
    friendCircles,
    privacyZones,
    meetupRequestsSent,
    meetupRequestsReceived,
    bestBuddies,
    eventModes,
    appFeedback,
    supportRequests,
    mediaAssets
  ].find((result) => result.error);

  if (failed?.error) {
    return NextResponse.json({ error: "Your data export could not be prepared." }, { status: 500 });
  }

  const bundle: ExportBundle = {
    exportedAt: new Date().toISOString(),
    account: {
      id: userId,
      email: user.email ?? null
    },
    data: {
      profile: profile.data,
      subscription: subscription.data,
      preferences: preferences.data,
      currentLocation: location.data
        ? {
            ...location.data,
            note: "Exact coordinates and GPS accuracy are excluded from exports by Mad Buddy's privacy rules."
          }
        : null,
      friendships: [...(friendsOne.data ?? []), ...(friendsTwo.data ?? [])],
      friendRequests: {
        sent: sentRequests.data ?? [],
        received: receivedRequests.data ?? []
      },
      blockedUsers: {
        blockedByMe: blockedByMe.data ?? [],
        blockingMe: blockingMe.data ?? []
      },
      notifications: notifications.data ?? [],
      reports: {
        madeByMe: reportsMade.data ?? [],
        aboutMe: reportsAboutMe.data ?? []
      },
      consentLogs: consentLogs.data ?? [],
      friendCircles: friendCircles.data ?? [],
      privacyZones:
        privacyZones.data?.map((zone) => ({
          id: zone.id,
          user_id: zone.user_id,
          name: zone.name,
          radius: zone.radius,
          is_active: zone.is_active,
          created_at: zone.created_at,
          updated_at: zone.updated_at,
          note: "Exact zone coordinates are excluded from exports by Mad Buddy's privacy rules."
        })) ?? [],
      meetupRequests: {
        sent: meetupRequestsSent.data ?? [],
        received: meetupRequestsReceived.data ?? []
      },
      bestBuddies: bestBuddies.data ?? [],
      eventModes: eventModes.data ?? [],
      appFeedback: appFeedback.data ?? [],
      supportRequests: supportRequests.data ?? [],
      mediaAssets: mediaAssets.data ?? []
    }
  };

  return new NextResponse(JSON.stringify(bundle, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="mad-buddy-export-${userId.slice(0, 8)}.json"`,
      "Cache-Control": "no-store"
    }
  });
}
