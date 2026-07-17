"use server";

import { z } from "zod";
import { deliverNotification } from "@/lib/notifications/server";
import { consumeRateLimit, rateLimitMessage } from "@/lib/security/rate-limit";
import { createSupabaseServerClient } from "@/lib/supabase/server";

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
   * savePrivacySetupAction (hidden by default) — when omitted, this action
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

  const { error: profileError } = await supabase.from("profiles").upsert({
    user_id: user.id,
    full_name: parsed.data.fullName,
    username: parsed.data.username,
    bio: parsed.data.bio || null,
    mood_status: parsed.data.moodStatus || null,
    ...(parsed.data.visibility ? { visibility_status: visibilityMap[parsed.data.visibility] } : {}),
    is_onboarded: true
  });

  if (profileError) {
    return { ok: false, message: profileError.message };
  }

  const { error: preferencesError } = await supabase.from("user_preferences").upsert({
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
    return { ok: false, message: preferencesError.message };
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

    const { data: friendProfile, error: friendError } = await supabase
      .from("profiles")
      .select("user_id, full_name")
      .eq("username", friendUsername)
      .maybeSingle();

    if (friendError) {
      return { ok: false, message: friendError.message };
    }

    if (friendProfile?.user_id) {
      const { error: requestError } = await supabase.from("friend_requests").insert({
        sender_id: user.id,
        receiver_id: friendProfile.user_id,
        status: "pending"
      });

      if (requestError) {
        return { ok: false, message: requestError.message };
      }

      await deliverNotification(supabase, {
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
