import "server-only";

import { z } from "zod";
import { deliverNotification } from "@/lib/notifications/server";
import { consumeRateLimit, rateLimitMessage } from "@/lib/security/rate-limit";
import {
  CURRENT_POLICY_VERSION,
  glowDurationMs,
  normalizePrivacySetup,
  type PrivacySetup
} from "@/lib/onboarding/rules";
import { recordMilestone } from "@/lib/onboarding/service";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSupabaseServerEnv } from "@/lib/supabase/env";
import { normalizeUsername, validateUsername } from "@/lib/profile/rules";

/**
 * Transport-agnostic onboarding services. Each takes an already-authenticated
 * `userId`; shared by the web Server Actions (`completeOnboardingAction`,
 * `savePrivacySetupAction`) and the mobile `/api/onboarding/*` routes.
 */

export type ServiceResult = { ok: boolean; message: string; field?: "username" };

function serviceRoleEnvMessage(): string | null {
  const env = getSupabaseServerEnv();
  if (!env.url || !env.serviceRoleKey) {
    return "This action needs the server database configuration.";
  }
  return null;
}

const onboardingSchema = z.object({
  fullName: z.string().trim().min(2).max(80),
  username: z
    .string()
    .trim()
    .toLowerCase()
    .min(3)
    .max(24)
    .regex(/^[a-z0-9_]+$/),
  bio: z.string().trim().max(160).optional(),
  moodStatus: z.string().trim().max(80).optional(),
  /**
   * Legacy field. The spec-correct PrivacySetupPanel now owns visibility via
   * savePrivacySetup (hidden by default), when omitted, this action leaves
   * visibility_status alone.
   */
  visibility: z.enum(["friends", "app_open", "ghost"]).optional(),
  notifications: z.enum(["smart", "requests", "quiet"]),
  firstFriend: z
    .string()
    .trim()
    .toLowerCase()
    .max(24)
    .regex(/^[a-z0-9_]*$/)
    .optional()
});

const visibilityMap = {
  friends: "visible",
  app_open: "app_open_only",
  ghost: "ghost"
} as const;

export async function completeOnboarding(userId: string, input: unknown): Promise<ServiceResult> {
  const parsed = onboardingSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: "Check your onboarding details and try again." };
  }

  const username = normalizeUsername(parsed.data.username);
  const usernameError = validateUsername(username);
  if (usernameError) return { ok: false, message: usernameError, field: "username" };

  const admin = createSupabaseAdminClient();

  const { data: usernameOwner, error: usernameLookupError } = await admin
    .from("profiles")
    .select("user_id")
    .or(`username.eq.${username},username_normalized.eq.${username}`)
    .limit(1)
    .maybeSingle();
  if (usernameLookupError) return { ok: false, message: "That username could not be checked.", field: "username" };
  if (usernameOwner && usernameOwner.user_id !== userId) {
    return { ok: false, message: "That username is already taken. Try another one.", field: "username" };
  }

  // Upsert on user_id: the profile row already exists (created at sign-up / by
  // ensureProfileForUser for OAuth), so without this the default id-PK conflict
  // target would try to INSERT a second row and violate the user_id unique
  // constraint — which is what surfaced as "Your profile could not be saved."
  const { error: profileError } = await admin.from("profiles").upsert(
    {
      user_id: userId,
      full_name: parsed.data.fullName,
      username,
      username_normalized: username,
      bio: parsed.data.bio || null,
      mood_status: parsed.data.moodStatus || null,
      ...(parsed.data.visibility ? { visibility_status: visibilityMap[parsed.data.visibility] } : {}),
      // The final onboarding action flips this only after required progress is
      // confirmed, preventing a half-finished account from entering the app.
      is_onboarded: false
    },
    { onConflict: "user_id" }
  );

  if (profileError) {
    // 23505 here means the chosen username belongs to someone else.
    if (profileError.code === "23505") {
      return { ok: false, message: "That username is already taken. Try another one.", field: "username" };
    }
    return { ok: false, message: "Your profile could not be saved." };
  }

  const { error: preferencesError } = await admin.from("user_preferences").upsert(
    {
      user_id: userId,
      mood_status: parsed.data.moodStatus || null,
      notification_preferences: {
        nearbyAlerts: parsed.data.notifications === "smart",
        requestAlertsOnly: parsed.data.notifications === "requests",
        quietMode: parsed.data.notifications === "quiet",
        updatedAt: new Date().toISOString()
      }
    },
    { onConflict: "user_id" }
  );

  if (preferencesError) {
    return { ok: false, message: "Your preferences could not be saved." };
  }

  const friendUsername = parsed.data.firstFriend;

  if (friendUsername && friendUsername !== parsed.data.username) {
    const rateLimit = await consumeRateLimit({ action: "friends.request", userId });

    if (!rateLimit.allowed) {
      return { ok: false, message: rateLimitMessage(rateLimit.resetAt) };
    }

    const { data: friendProfile, error: friendError } = await admin
      .from("profiles")
      .select("user_id, full_name")
      .eq("username", friendUsername)
      .maybeSingle();

    if (friendError) {
      return { ok: false, message: "That username could not be checked." };
    }

    if (friendProfile?.user_id) {
      const { data: blocked } = await admin
        .from("blocked_users")
        .select("id")
        .or(
          `and(blocker_id.eq.${userId},blocked_id.eq.${friendProfile.user_id}),and(blocker_id.eq.${friendProfile.user_id},blocked_id.eq.${userId})`
        )
        .limit(1)
        .maybeSingle();
      if (blocked) return { ok: false, message: "That account is not available to connect." };

      const { error: requestError } = await admin.from("friend_requests").insert({
        sender_id: userId,
        receiver_id: friendProfile.user_id,
        status: "pending"
      });

      if (requestError) {
        return { ok: false, message: "The Muddy request could not be sent." };
      }

      await deliverNotification(admin, {
        userId: friendProfile.user_id,
        senderId: userId,
        type: "friend_request_received",
        title: "Muddy request received",
        message: `${parsed.data.fullName} wants to connect before any glow signals appear.`
      });
    }
  }

  return { ok: true, message: "Onboarding saved." };
}

const privacySetupSchema = z.object({
  glowAudience: z.enum(["hidden", "close_friends", "selected_circles", "all_muddies"]),
  glowDuration: z.enum(["1h", "4h", "until_tonight", "until_off"]),
  wavesFrom: z.enum(["all_muddies", "close_friends", "nobody"]),
  pingsFrom: z.enum(["all_muddies", "close_friends", "nobody"]),
  onlineStatusVisible: z.boolean(),
  contactMatchingEnabled: z.boolean()
});

/**
 * Saves the initial privacy setup. Glow is only ever activated later, after a
 * real presence update, saving "close_friends" here does NOT make the user
 * visible (spec §32 step 7).
 */
export async function savePrivacySetup(userId: string, input: unknown): Promise<ServiceResult> {
  const envMessage = serviceRoleEnvMessage();
  if (envMessage) return { ok: false, message: envMessage };

  const parsed = privacySetupSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Check your privacy choices and try again." };
  const setup: PrivacySetup = normalizePrivacySetup(parsed.data);

  const admin = createSupabaseAdminClient();
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();

  // Hidden means Ghost Mode: the user is not visible at all until they choose
  // otherwise. Anything else stays "visible" but glow still needs presence.
  await admin
    .from("profiles")
    .update({ visibility_status: setup.glowAudience === "hidden" ? "ghost" : "visible" })
    .eq("user_id", userId);

  // Record the chosen glow session (batch-2 machinery), except for hidden.
  if (setup.glowAudience !== "hidden") {
    const durationMs = glowDurationMs(setup.glowDuration, nowMs);
    await admin
      .from("visibility_sessions")
      .update({ status: "ended", updated_at: nowIso })
      .eq("user_id", userId)
      .eq("feature_type", "glow")
      .eq("status", "active");

    await admin.from("visibility_sessions").insert({
      user_id: userId,
      feature_type: "glow",
      visibility_mode:
        setup.glowAudience === "all_muddies"
          ? "all_muddies"
          : setup.glowAudience === "close_friends"
            ? "close_friends"
            : "selected_circles",
      ends_at: durationMs ? new Date(nowMs + durationMs).toISOString() : null,
      source: "manual",
      status: "active"
    });
  }

  await Promise.all([
    admin.from("privacy_setup_versions").upsert(
      {
        user_id: userId,
        policy_version: CURRENT_POLICY_VERSION,
        setup_completed_at: nowIso,
        last_reviewed_at: nowIso,
        updated_at: nowIso
      },
      { onConflict: "user_id" }
    ),
    admin
      .from("onboarding_progress")
      .upsert(
        {
          user_id: userId,
          privacy_reviewed_at: nowIso,
          visibility_configured_at: nowIso,
          updated_at: nowIso
        },
        { onConflict: "user_id" }
      ),
    recordMilestone(admin, userId, "privacy_setup_completed"),
    import("@/lib/engagement/achievements").then(({ grantAchievement }) =>
      grantAchievement(admin, userId, "privacy_pro")
    )
  ]);

  return {
    ok: true,
    message:
      setup.glowAudience === "hidden"
        ? "Saved. You're hidden until you choose to turn your glow on."
        : "Saved. Your glow turns on once your location updates."
  };
}
