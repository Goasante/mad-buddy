import "server-only";

import { z } from "zod";
import {
  contentTierLimitsFor,
  resolveMomentVisibility,
  validateExpiry,
  validateMomentContent
} from "@/lib/content/moments";
import { detectLocationRisk, LOCATION_WARNING_MESSAGE } from "@/lib/content/safety";
import { guardAction } from "@/lib/admin/enforcement";
import { upgradePromptFor } from "@/lib/billing/entitlements";
import { getCurrentSubscriptionAccess } from "@/lib/premium/access";
import { consumeRateLimit, rateLimitMessage } from "@/lib/security/rate-limit";
import { areApprovedMuddies, isBlockedEitherDirection } from "@/lib/social/permissions";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSupabaseServerEnv } from "@/lib/supabase/env";
import type { MomentAudienceType, ReactionType } from "@/lib/supabase/database.types";

/**
 * Mobile Moments v1: text-only posting + reactions. The full web
 * createMomentAction (media upload, circle/muddy targeting) stays as-is; this
 * covers the native subset (text to all_muddies / nearby_muddies) reusing the
 * same tier limits, guards, and visibility rules. The feed itself is the shared
 * buildMomentFeed (called directly by the route).
 */

type Admin = ReturnType<typeof createSupabaseAdminClient>;

export type MomentResult = {
  ok: boolean;
  message: string;
  momentId?: string;
  locationWarning?: string;
};

export const createTextMomentSchema = z.object({
  textContent: z.string().min(1).max(500),
  audienceType: z.enum(["all_muddies", "nearby_muddies"])
});

const uuidSchema = z.string().uuid();

function serviceRoleEnvMessage(): string | null {
  const env = getSupabaseServerEnv();
  if (!env.url || !env.serviceRoleKey) {
    return "This action needs the server database configuration.";
  }
  return null;
}

export async function createTextMoment(userId: string, input: unknown): Promise<MomentResult> {
  const envMessage = serviceRoleEnvMessage();
  if (envMessage) return { ok: false, message: envMessage };

  const parsed = createTextMomentSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Write something to share (up to 500 characters)." };

  const contentError = validateMomentContent({
    contentType: "text",
    textContent: parsed.data.textContent,
    mediaId: null,
    caption: null
  });
  if (contentError) return { ok: false, message: contentError };

  const nowMs = Date.now();
  const expiresAt = new Date(nowMs + 24 * 60 * 60 * 1000).toISOString();
  const expiryError = validateExpiry(Date.parse(expiresAt), nowMs);
  if (expiryError) return { ok: false, message: expiryError };

  const rateLimit = await consumeRateLimit({ action: "moments.create", userId });
  if (!rateLimit.allowed) return { ok: false, message: rateLimitMessage(rateLimit.resetAt) };

  const admin = createSupabaseAdminClient();

  const guard = await guardAction(admin, { userId, surface: "moments" });
  if (!guard.allowed) return { ok: false, message: guard.message };

  const access = await getCurrentSubscriptionAccess(userId);
  const limits = contentTierLimitsFor(access.plan);

  const dayAgo = new Date(nowMs - 24 * 60 * 60 * 1000).toISOString();
  const { count: todayCount } = await admin
    .from("moments")
    .select("id", { count: "exact", head: true })
    .eq("author_id", userId)
    .gte("created_at", dayAgo);
  if ((todayCount ?? 0) >= limits.maxActiveMomentsPerDay) {
    return {
      ok: false,
      message: upgradePromptFor("max_daily_moments", access.plan) ?? "You've reached your Moment limit for today."
    };
  }

  if (parsed.data.audienceType === "nearby_muddies") {
    const { count: nearbyCount } = await admin
      .from("moments")
      .select("id", { count: "exact", head: true })
      .eq("author_id", userId)
      .eq("audience_type", "nearby_muddies")
      .eq("status", "active")
      .gt("expires_at", new Date(nowMs).toISOString());
    if ((nearbyCount ?? 0) >= limits.maxActiveNearbyMoments) {
      return {
        ok: false,
        message:
          access.plan === "free"
            ? "Free plan allows one active nearby Moment at a time."
            : "You've reached your active nearby Moment limit."
      };
    }
  }

  const { data: moment, error } = await admin
    .from("moments")
    .insert({
      author_id: userId,
      content_type: "text",
      text_content: parsed.data.textContent.trim(),
      media_id: null,
      caption: null,
      audience_type: parsed.data.audienceType as MomentAudienceType,
      status: "active",
      expires_at: expiresAt
    })
    .select("id")
    .single();
  if (error || !moment) return { ok: false, message: "Couldn't share that Moment. Try again." };

  const risk = detectLocationRisk(parsed.data.textContent);
  return {
    ok: true,
    message: "Moment shared.",
    momentId: moment.id,
    locationWarning: risk.warn ? LOCATION_WARNING_MESSAGE : undefined
  };
}

/** Re-checks that the viewer may actually see the Moment before interacting. */
async function canViewMoment(admin: Admin, viewerId: string, momentId: string): Promise<boolean> {
  const { data: moment } = await admin
    .from("moments")
    .select("id, author_id, status, expires_at, audience_type")
    .eq("id", momentId)
    .maybeSingle();
  if (!moment) return false;
  if (moment.author_id === viewerId) return true;

  const [mutual, blocked, { data: profile }, { data: hidden }] = await Promise.all([
    areApprovedMuddies(admin, moment.author_id, viewerId),
    isBlockedEitherDirection(admin, moment.author_id, viewerId),
    admin.from("profiles").select("visibility_status").eq("user_id", moment.author_id).maybeSingle(),
    admin
      .from("hidden_content")
      .select("id")
      .eq("user_id", viewerId)
      .eq("content_type", "moment")
      .eq("content_id", momentId)
      .maybeSingle()
  ]);

  return resolveMomentVisibility({
    isAuthor: false,
    status: moment.status,
    expiresAtMs: Date.parse(moment.expires_at),
    nowMs: Date.now(),
    areApprovedMuddies: mutual,
    isBlockedEitherDirection: blocked,
    authorGhostMode: profile?.visibility_status === "ghost",
    viewerHidThis: Boolean(hidden),
    audienceType: moment.audience_type,
    viewerInAudience: true,
    viewerNearbyAndFresh: true
  }).visible;
}

export async function reactToMoment(userId: string, momentId: string, reaction: string): Promise<MomentResult> {
  const envMessage = serviceRoleEnvMessage();
  if (envMessage) return { ok: false, message: envMessage };
  if (!uuidSchema.safeParse(momentId).success) return { ok: false, message: "Moment not found." };

  const parsed = z.enum(["heart", "laugh", "wave", "fire", "clap"]).safeParse(reaction);
  if (!parsed.success) return { ok: false, message: "Choose a valid reaction." };

  const rateLimit = await consumeRateLimit({ action: "moments.react", userId });
  if (!rateLimit.allowed) return { ok: false, message: rateLimitMessage(rateLimit.resetAt) };

  const admin = createSupabaseAdminClient();
  if (!(await canViewMoment(admin, userId, momentId))) {
    return { ok: false, message: "That Moment isn't available." };
  }

  const { error } = await admin
    .from("moment_reactions")
    .upsert(
      { moment_id: momentId, user_id: userId, reaction_type: parsed.data as ReactionType },
      { onConflict: "moment_id,user_id" }
    );
  if (error) return { ok: false, message: "Couldn't add your reaction." };
  return { ok: true, message: "Reaction added." };
}

export async function removeMomentReaction(userId: string, momentId: string): Promise<MomentResult> {
  const envMessage = serviceRoleEnvMessage();
  if (envMessage) return { ok: false, message: envMessage };
  if (!uuidSchema.safeParse(momentId).success) return { ok: false, message: "Moment not found." };

  const admin = createSupabaseAdminClient();
  await admin.from("moment_reactions").delete().eq("moment_id", momentId).eq("user_id", userId);
  return { ok: true, message: "Reaction removed." };
}
