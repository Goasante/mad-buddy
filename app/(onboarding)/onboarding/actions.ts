"use server";

import { z } from "zod";
import { deliverNotification } from "@/lib/notifications/server";
import { consumeRateLimit, rateLimitMessage } from "@/lib/security/rate-limit";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export type OnboardingActionState = {
  ok: boolean;
  message: string;
};

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
   * savePrivacySetupAction (hidden by default), when omitted, this action
   * leaves visibility_status alone.
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

export async function completeOnboardingAction(input: unknown): Promise<OnboardingActionState> {
  const parsed = onboardingSchema.safeParse(input);

  if (!parsed.success) {
    return { ok: false, message: "Check your onboarding details and try again." };
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error: userError
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return { ok: false, message: "Log in before finishing onboarding." };
  }
  const admin = createSupabaseAdminClient();

  const { error: profileError } = await admin.from("profiles").upsert({
    user_id: user.id,
    full_name: parsed.data.fullName,
    username: parsed.data.username,
    bio: parsed.data.bio || null,
    mood_status: parsed.data.moodStatus || null,
    ...(parsed.data.visibility ? { visibility_status: visibilityMap[parsed.data.visibility] } : {}),
    is_onboarded: true
  });

  if (profileError) {
    return { ok: false, message: "Your profile could not be saved." };
  }

  const { error: preferencesError } = await admin.from("user_preferences").upsert({
    user_id: user.id,
    mood_status: parsed.data.moodStatus || null,
    notification_preferences: {
      nearbyAlerts: parsed.data.notifications === "smart",
      requestAlertsOnly: parsed.data.notifications === "requests",
      quietMode: parsed.data.notifications === "quiet",
      updatedAt: new Date().toISOString()
    }
  });

  if (preferencesError) {
    return { ok: false, message: "Your preferences could not be saved." };
  }

  const friendUsername = parsed.data.firstFriend;

  if (friendUsername && friendUsername !== parsed.data.username) {
    const rateLimit = await consumeRateLimit({
      action: "friends.request",
      userId: user.id
    });

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
      const { data: blocked } = await admin.from("blocked_users").select("id").or(
        `and(blocker_id.eq.${user.id},blocked_id.eq.${friendProfile.user_id}),and(blocker_id.eq.${friendProfile.user_id},blocked_id.eq.${user.id})`
      ).limit(1).maybeSingle();
      if (blocked) return { ok: false, message: "That account is not available to connect." };

      const { error: requestError } = await admin.from("friend_requests").insert({
        sender_id: user.id,
        receiver_id: friendProfile.user_id,
        status: "pending"
      });

      if (requestError) {
        return { ok: false, message: "The Muddy request could not be sent." };
      }

      await deliverNotification(admin, {
        userId: friendProfile.user_id,
        senderId: user.id,
        type: "friend_request_received",
        title: "Muddy request received",
        message: `${parsed.data.fullName} wants to connect before any glow signals appear.`
      });
    }
  }

  return { ok: true, message: "Onboarding saved." };
}
