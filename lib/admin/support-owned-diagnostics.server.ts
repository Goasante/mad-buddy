import "server-only";

import { calculateAge, dateKeyInTimeZone, validateDateOfBirth } from "@/lib/profile/birth-date";
import { presenceStateFor } from "@/lib/presence/freshness";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { SupportOwnedSnapshot } from "@/lib/admin/support-owned-diagnostics";

type Admin = ReturnType<typeof createSupabaseAdminClient>;

/**
 * Loads only the facts needed by the parallel Account Doctor diagnostics.
 *
 * Privacy boundary:
 * - DOB is reduced to an age band before this function returns.
 * - location is read as `last_updated` only; coordinates are never selected.
 * - profile-photo rows are reduced to counts; media ids/URLs are never selected.
 * - push endpoints, keys and native tokens are never selected.
 * - Linkr one-sided actions/candidates are never queried.
 * - notification payloads are never selected.
 */
export async function loadSupportOwnedSnapshot(
  admin: Admin,
  userId: string,
  now = new Date()
): Promise<SupportOwnedSnapshot> {
  const nowIso = now.toISOString();
  const nowMs = now.getTime();

  const [
    authResult,
    profileResult,
    activationResult,
    photoResult,
    birthResult,
    linkrResult,
    restrictionResult,
    locationResult,
    statusResult,
    notificationResult,
    webPushResult,
    nativePushResult,
    rateLimitResult,
    achievementResult
  ] = await Promise.all([
    admin.auth.admin.getUserById(userId),
    admin
      .from("profiles")
      .select("user_id, is_onboarded, avatar_url, visibility_status, deleted_at")
      .eq("user_id", userId)
      .maybeSingle(),
    admin.from("activation_milestones").select("milestone", { count: "exact", head: true }).eq("user_id", userId),
    admin.from("profile_photos").select("visibility").eq("user_id", userId),
    admin
      .from("profile_birth_details")
      .select("date_of_birth, correction_used_at")
      .eq("user_id", userId)
      .maybeSingle(),
    admin.from("linkr_profiles").select("enabled").eq("user_id", userId).maybeSingle(),
    admin
      .from("user_restrictions")
      .select("ends_at")
      .eq("user_id", userId)
      .in("restriction_type", ["suspended_temporary", "suspended_permanent"])
      .is("lifted_at", null),
    // Presence freshness needs only this timestamp. Exact coordinates are not
    // selected, so they cannot leak into the support snapshot by accident.
    admin.from("user_locations").select("last_updated").eq("user_id", userId).maybeSingle(),
    admin.from("user_statuses").select("expires_at").eq("user_id", userId),
    admin.from("notifications").select("id", { count: "exact", head: true }).eq("user_id", userId).eq("is_read", false),
    admin.from("push_subscriptions").select("id", { count: "exact", head: true }).eq("user_id", userId),
    admin.from("device_push_tokens").select("id", { count: "exact", head: true }).eq("user_id", userId),
    admin.from("rate_limits").select("window_end").eq("user_id", userId),
    admin.from("user_achievements").select("achievement_code", { count: "exact", head: true }).eq("user_id", userId)
  ]);

  /* A missing row is a valid diagnostic fact; a failed query is not. Never
   * turn an unavailable table/read into a zero and accidentally report a
   * healthy account. Auth is different: a missing auth identity is itself the
   * linkage finding this module is designed to surface. */
  const queryErrors = [
    profileResult.error,
    activationResult.error,
    photoResult.error,
    birthResult.error,
    linkrResult.error,
    restrictionResult.error,
    locationResult.error,
    statusResult.error,
    notificationResult.error,
    webPushResult.error,
    nativePushResult.error,
    rateLimitResult.error,
    achievementResult.error
  ].filter(Boolean);
  if (queryErrors.length > 0) throw new Error("Support-owned Account Doctor snapshot could not be loaded.");

  const profile = profileResult.data;
  const photos = photoResult.data ?? [];
  const publicShowcasePhotoCount = photos.filter((row) => row.visibility === "everyone").length;
  const hasAvatar = Boolean(profile?.avatar_url);

  const birth = birthResult.data;
  const today = dateKeyInTimeZone(now);
  let dobState: SupportOwnedSnapshot["dob"]["state"] = "missing";
  if (birth?.date_of_birth) {
    if (validateDateOfBirth(birth.date_of_birth, today)) {
      dobState = "invalid";
    } else {
      dobState = calculateAge(birth.date_of_birth, today) >= 18 ? "adult" : "under_18";
    }
  }

  const hasCurrentRestriction = (restrictionResult.data ?? []).some(
    (row) => !row.ends_at || Date.parse(row.ends_at) > nowMs
  );

  const lastUpdated = locationResult.data?.last_updated ?? null;
  const canonicalPresence = lastUpdated ? presenceStateFor(lastUpdated, nowMs) : null;
  /*
   * An expired location row is not itself drift. The proximity engine already
   * treats it as absent. Calling it "stale" here would manufacture a repair
   * recommendation for normal persisted latest-signal state, so only a
   * currently usable signal projects as fresh; expired projects as missing.
   * Grace is still usable by the canonical engine and therefore projects as
   * current rather than as a broken row.
   */
  const presenceSignal: SupportOwnedSnapshot["presence"]["signal"] =
    canonicalPresence === "fresh" || canonicalPresence === "grace" ? "fresh" : "missing";

  const visibility = profile?.visibility_status;
  const safeVisibility: SupportOwnedSnapshot["presence"]["visibility"] =
    visibility === "visible" || visibility === "ghost" || visibility === "app_open_only"
      ? visibility
      : "unknown";

  return {
    account: {
      authUserExists: Boolean(authResult.data.user) && !authResult.error,
      profileExists: Boolean(profile && !profile.deleted_at),
      isOnboarded: Boolean(profile?.is_onboarded)
    },
    activation: {
      milestoneCount: activationResult.count ?? 0
    },
    profile: {
      hasAvatar,
      showcasePhotoCount: photos.length,
      publicShowcasePhotoCount
    },
    dob: {
      state: dobState,
      selfServeCorrectionAvailable: !birth?.correction_used_at
    },
    linkr: {
      enabled: Boolean(linkrResult.data?.enabled),
      hasPublicPhoto: hasAvatar || publicShowcasePhotoCount > 0,
      ageEligible: dobState === "adult",
      accountRestricted: hasCurrentRestriction
    },
    presence: {
      visibility: safeVisibility,
      signal: presenceSignal,
      staleStatusCount: (statusResult.data ?? []).filter(
        (row) => Boolean(row.expires_at) && row.expires_at! <= nowIso
      ).length
    },
    notifications: {
      unreadCount: notificationResult.count ?? 0,
      webPushDevices: webPushResult.count ?? 0,
      nativePushDevices: nativePushResult.count ?? 0,
      // There is no canonical age-based "stale push token" threshold. Provider
      // rejection (404/410/unregistered) is already the authority that deletes
      // dead registrations, so Account Doctor must not invent one from age.
      stalePushDevices: 0
    },
    features: {
      activeRateLimitCount: (rateLimitResult.data ?? []).filter((row) => row.window_end > nowIso).length
    },
    journey: {
      achievementCount: achievementResult.count ?? 0,
      milestoneCount: activationResult.count ?? 0
    }
  };
}
