"use server";

import { z } from "zod";
import {
  buildMomentFeed,
  hideContentForUser,
  queueMediaDeletion,
  type VisibleMoment
} from "@/lib/content/service";
import {
  contentTierLimitsFor,
  resolveMomentVisibility,
  validateExpiry,
  validateMomentContent
} from "@/lib/content/moments";
import {
  detectLocationRisk,
  isReportCategory,
  LOCATION_WARNING_MESSAGE,
  REPORT_CONFIRMATION_MESSAGE,
  requiresHumanReview
} from "@/lib/content/safety";
import { guardAction } from "@/lib/admin/enforcement";
import {
  sniffImageKind,
  storageKeyFor,
  uploadValidationMessage,
  validateImageUpload
} from "@/lib/media/validation";
import { upgradePromptFor } from "@/lib/billing/entitlements";
import { getCurrentSubscriptionAccess } from "@/lib/premium/access";
import { consumeRateLimit, rateLimitMessage } from "@/lib/security/rate-limit";
import { areApprovedMuddies, isBlockedEitherDirection } from "@/lib/social/permissions";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSupabaseServerEnv } from "@/lib/supabase/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type {
  MomentAudienceType,
  ReactionType,
  ReportableContentType
} from "@/lib/supabase/database.types";

export type MomentActionState = {
  ok: boolean;
  message: string;
  momentId?: string;
  mediaId?: string;
  /** Non-blocking nudge shown before/after posting (spec §55). */
  locationWarning?: string;
};

const uuidSchema = z.string().uuid();

function missingEnvState(): MomentActionState | null {
  const env = getSupabaseServerEnv();
  if (!env.url || !env.serviceRoleKey) {
    return { ok: false, message: "This action needs the server database configuration." };
  }
  return null;
}

async function getAuthedUserId() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error
  } = await supabase.auth.getUser();
  return error || !user ? null : user.id;
}

// ---------------------------------------------------------------------------
// Media upload (spec §38, §39)
// ---------------------------------------------------------------------------

/**
 * Uploads an image to the PRIVATE media bucket and records the asset. Media is
 * never publicly addressable, viewers only ever receive short-lived signed
 * URLs minted after their permission on the parent object is checked (§41).
 */
export async function uploadMomentMediaAction(formData: FormData): Promise<MomentActionState> {
  const missing = missingEnvState();
  if (missing) return missing;

  const userId = await getAuthedUserId();
  if (!userId) return { ok: false, message: "Log in before uploading." };

  const rateLimit = await consumeRateLimit({ action: "media.upload", userId });
  if (!rateLimit.allowed) return { ok: false, message: rateLimitMessage(rateLimit.resetAt) };

  const admin = createSupabaseAdminClient();

  // Kill switch + account restrictions, before any bytes are read or stored.
  const guard = await guardAction(admin, { userId, surface: "moments", control: "media_uploads" });
  if (!guard.allowed) return { ok: false, message: guard.message };

  const file = formData.get("media");
  if (!(file instanceof File)) return { ok: false, message: "Choose an image first." };

  const headerBytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const validation = validateImageUpload({
    claimedMimeType: file.type,
    headerBytes,
    sizeBytes: file.size,
    context: "moment"
  });
  if (!validation.valid) return { ok: false, message: uploadValidationMessage(validation.reason) };

  const { data: asset, error: assetError } = await admin
    .from("media_assets")
    .insert({
      owner_id: userId,
      // Placeholder; replaced with the real key below once we know the id.
      storage_key: `pending/${userId}/${Date.now()}`,
      content_type: validation.mimeType as "image/jpeg" | "image/png" | "image/webp",
      size_bytes: file.size,
      context_type: "moment",
      processing_status: "pending"
    })
    .select("id")
    .single();
  if (assetError || !asset) return { ok: false, message: "Couldn't prepare the upload." };

  const key = storageKeyFor({ ownerId: userId, context: "moment", mediaId: asset.id, kind: validation.kind });

  // Strip EXIF (GPS!) and build thumb/feed variants BEFORE anything reaches
  // storage, the stored original is already the metadata-free re-encode.
  let processed;
  try {
    const { processImageUpload } = await import("@/lib/media/processing");
    processed = await processImageUpload(Buffer.from(await file.arrayBuffer()), validation.kind);
  } catch {
    await admin.from("media_assets").delete().eq("id", asset.id).eq("owner_id", userId);
    return { ok: false, message: "That image couldn't be processed. Try a different photo." };
  }

  const { toStorageArrayBuffer, variantStorageKey } = await import("@/lib/media/processing");
  const { error: uploadError } = await admin.storage.from("media").upload(
    key,
    toStorageArrayBuffer(processed.original.buffer),
    {
    contentType: validation.mimeType,
    upsert: false
    }
  );

  // Compensating cleanup: an orphaned asset row must not survive a failed
  // upload (spec §18, §46).
  if (uploadError) {
    await admin.from("media_assets").delete().eq("id", asset.id).eq("owner_id", userId);
    return { ok: false, message: "Couldn't upload that image. Try again." };
  }

  // Variants are best-effort: signMediaForAsset falls back to the (already
  // stripped) original if a variant upload failed.
  const variantRows: Array<{ variant: "thumb" | "feed"; key: string; image: (typeof processed.variants)["thumb"] }> = [
    { variant: "thumb", key: variantStorageKey(key, "thumb"), image: processed.variants.thumb },
    { variant: "feed", key: variantStorageKey(key, "feed"), image: processed.variants.feed }
  ];
  await Promise.all(
    variantRows.map(async ({ variant, key: variantKey, image }) => {
      const { error } = await admin.storage.from("media").upload(variantKey, toStorageArrayBuffer(image.buffer), {
        contentType: validation.mimeType,
        upsert: false
      });
      if (error) return;
      await admin.from("media_variants").insert({
        media_asset_id: asset.id,
        variant_type: variant,
        storage_key: variantKey,
        width: image.width,
        height: image.height,
        size_bytes: image.buffer.byteLength
      });
    })
  );

  // Storage can acknowledge an upload even when a runtime has transformed its
  // request body. Verify the persisted signature before exposing the asset.
  const { data: storedOriginal, error: verifyError } = await admin.storage.from("media").download(key);
  const storedKind = storedOriginal
    ? sniffImageKind(new Uint8Array(await storedOriginal.slice(0, 12).arrayBuffer()))
    : null;
  if (verifyError || storedKind !== validation.kind) {
    const storedPaths = [key, ...variantRows.map((row) => row.key)];
    await admin.storage.from("media").remove(storedPaths);
    await admin.from("media_assets").delete().eq("id", asset.id).eq("owner_id", userId);
    return { ok: false, message: "That photo was not stored correctly. Please try again." };
  }

  const { error: readyError } = await admin
    .from("media_assets")
    .update({
      storage_key: key,
      processing_status: "ready",
      width: processed.original.width,
      height: processed.original.height,
      size_bytes: processed.original.buffer.byteLength,
      updated_at: new Date().toISOString()
    })
    .eq("id", asset.id)
    .eq("owner_id", userId);

  if (readyError) {
    const storedPaths = [key, ...variantRows.map((row) => row.key)];
    await admin.storage.from("media").remove(storedPaths);
    await admin.from("media_assets").delete().eq("id", asset.id).eq("owner_id", userId);
    return { ok: false, message: "Couldn't finish processing that image. Try again." };
  }

  return { ok: true, message: "Image ready.", mediaId: asset.id };
}

// ---------------------------------------------------------------------------
// Create / delete Moments (spec §6, §15, §16)
// ---------------------------------------------------------------------------

const createMomentSchema = z.object({
  contentType: z.enum(["text", "photo"]),
  textContent: z.string().max(500).optional(),
  mediaId: uuidSchema.optional(),
  caption: z.string().max(200).optional(),
  audienceType: z.enum([
    "close_friends",
    "selected_muddies",
    "selected_circles",
    "nearby_muddies",
    "event_circle",
    "plan"
  ]),
  targetIds: z.array(uuidSchema).max(50).optional(),
  expiresAt: z.string().datetime({ offset: true })
});

export async function createMomentAction(input: unknown): Promise<MomentActionState> {
  const missing = missingEnvState();
  if (missing) return missing;

  const parsed = createMomentSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Check the Moment details and try again." };

  const contentError = validateMomentContent({
    contentType: parsed.data.contentType,
    textContent: parsed.data.textContent ?? null,
    mediaId: parsed.data.mediaId ?? null,
    caption: parsed.data.caption ?? null
  });
  if (contentError) return { ok: false, message: contentError };

  const nowMs = Date.now();
  const expiryError = validateExpiry(Date.parse(parsed.data.expiresAt), nowMs);
  if (expiryError) return { ok: false, message: expiryError };

  const userId = await getAuthedUserId();
  if (!userId) return { ok: false, message: "Log in before sharing a Moment." };

  const rateLimit = await consumeRateLimit({ action: "moments.create", userId });
  if (!rateLimit.allowed) return { ok: false, message: rateLimitMessage(rateLimit.resetAt) };

  const admin = createSupabaseAdminClient();

  const guard = await guardAction(admin, { userId, surface: "moments" });
  if (!guard.allowed) return { ok: false, message: guard.message };

  const access = await getCurrentSubscriptionAccess(userId);
  const limits = contentTierLimitsFor(access.plan);

  // Tier caps: active Moments today, and concurrent nearby Moments.
  const dayAgo = new Date(nowMs - 24 * 60 * 60 * 1000).toISOString();
  const { count: todayCount } = await admin
    .from("moments")
    .select("id", { count: "exact", head: true })
    .eq("author_id", userId)
    .gte("created_at", dayAgo);
  if ((todayCount ?? 0) >= limits.maxActiveMomentsPerDay) {
    return {
      ok: false,
      message:
        upgradePromptFor("max_daily_moments", access.plan) ?? "You've reached your Moment limit for today."
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

  // The media must belong to this user (§15), never trust a client-supplied id.
  if (parsed.data.mediaId) {
    const { data: asset } = await admin
      .from("media_assets")
      .select("id")
      .eq("id", parsed.data.mediaId)
      .eq("owner_id", userId)
      .is("deleted_at", null)
      .maybeSingle();
    if (!asset) return { ok: false, message: "That image isn't available." };
  }

  const { data: moment, error } = await admin
    .from("moments")
    .insert({
      author_id: userId,
      content_type: parsed.data.contentType,
      text_content: parsed.data.textContent?.trim() || null,
      media_id: parsed.data.mediaId ?? null,
      caption: parsed.data.caption?.trim() || null,
      audience_type: parsed.data.audienceType as MomentAudienceType,
      status: "active",
      expires_at: parsed.data.expiresAt
    })
    .select("id")
    .single();
  if (error || !moment) return { ok: false, message: "Couldn't share that Moment. Try again." };

  // Audience targets: only the user's own circles / real Muddies qualify.
  const targetIds = [...new Set(parsed.data.targetIds ?? [])];
  if (targetIds.length > 0) {
    if (parsed.data.audienceType === "selected_circles") {
      const { data: ownedCircles } = await admin
        .from("friend_circles")
        .select("id")
        .eq("user_id", userId)
        .is("archived_at", null)
        .in("id", targetIds);
      const rows = (ownedCircles ?? []).map((circle) => ({
        moment_id: moment.id,
        target_type: "circle" as const,
        target_id: circle.id
      }));
      if (rows.length > 0) await admin.from("moment_audience_targets").insert(rows);
    } else if (parsed.data.audienceType === "selected_muddies") {
      const eligible: string[] = [];
      for (const targetId of targetIds) {
        const [mutual, blocked] = await Promise.all([
          areApprovedMuddies(admin, userId, targetId),
          isBlockedEitherDirection(admin, userId, targetId)
        ]);
        if (mutual && !blocked) eligible.push(targetId);
      }
      if (eligible.length > 0) {
        await admin.from("moment_audience_targets").insert(
          eligible.map((targetId) => ({
            moment_id: moment.id,
            target_type: "user" as const,
            target_id: targetId
          }))
        );
      }
    }
  }

  // Warn (never block) if the text may reveal an exact location (§55).
  {
    const { grantMomentAchievements } = await import("@/lib/engagement/achievements");
    await grantMomentAchievements(admin, userId);
  }

  const risk = detectLocationRisk(`${parsed.data.textContent ?? ""} ${parsed.data.caption ?? ""}`);
  return {
    ok: true,
    message: "Moment shared.",
    momentId: moment.id,
    locationWarning: risk.warn ? LOCATION_WARNING_MESSAGE : undefined
  };
}

export async function deleteMomentAction(momentId: string): Promise<MomentActionState> {
  const missing = missingEnvState();
  if (missing) return missing;
  if (!uuidSchema.safeParse(momentId).success) return { ok: false, message: "Moment not found." };

  const userId = await getAuthedUserId();
  if (!userId) return { ok: false, message: "Log in first." };

  const admin = createSupabaseAdminClient();
  const { data: moment } = await admin
    .from("moments")
    .select("id, media_id")
    .eq("id", momentId)
    .eq("author_id", userId)
    .maybeSingle();
  if (!moment) return { ok: false, message: "Moment not found." };

  const { error } = await admin
    .from("moments")
    .update({
      status: "deleted_by_user",
      deleted_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    })
    .eq("id", momentId)
    .eq("author_id", userId);
  if (error) return { ok: false, message: "Couldn't delete that Moment." };

  // Deleting the parent revokes access and queues the media (spec §45).
  if (moment.media_id) await queueMediaDeletion(admin, moment.media_id, "parent_deleted");

  return { ok: true, message: "Moment deleted." };
}

/** The viewer's authorized feed (spec §14). */
export async function getMomentFeedAction(): Promise<VisibleMoment[]> {
  const env = getSupabaseServerEnv();
  if (!env.url || !env.serviceRoleKey) return [];
  const userId = await getAuthedUserId();
  if (!userId) return [];
  const admin = createSupabaseAdminClient();
  return buildMomentFeed(admin, userId);
}

// ---------------------------------------------------------------------------
// Reactions (spec §11), visible to author and reactor only.
// ---------------------------------------------------------------------------

export async function reactToMomentAction(
  momentId: string,
  reaction: string
): Promise<MomentActionState> {
  const missing = missingEnvState();
  if (missing) return missing;
  if (!uuidSchema.safeParse(momentId).success) return { ok: false, message: "Moment not found." };

  const parsed = z.enum(["heart", "laugh", "wave", "fire", "clap"]).safeParse(reaction);
  if (!parsed.success) return { ok: false, message: "Choose a valid reaction." };

  const userId = await getAuthedUserId();
  if (!userId) return { ok: false, message: "Log in first." };

  const rateLimit = await consumeRateLimit({ action: "moments.react", userId });
  if (!rateLimit.allowed) return { ok: false, message: rateLimitMessage(rateLimit.resetAt) };

  const admin = createSupabaseAdminClient();
  // Re-check visibility: you can only react to something you may actually see.
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

export async function removeMomentReactionAction(momentId: string): Promise<MomentActionState> {
  const missing = missingEnvState();
  if (missing) return missing;
  if (!uuidSchema.safeParse(momentId).success) return { ok: false, message: "Moment not found." };

  const userId = await getAuthedUserId();
  if (!userId) return { ok: false, message: "Log in first." };

  const admin = createSupabaseAdminClient();
  await admin.from("moment_reactions").delete().eq("moment_id", momentId).eq("user_id", userId);
  return { ok: true, message: "Reaction removed." };
}

async function canViewMoment(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  viewerId: string,
  momentId: string
): Promise<boolean> {
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

  // Audience membership is enforced by the feed; this is the interaction floor.
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

// ---------------------------------------------------------------------------
// Reporting (spec §50), hide immediately, never expose reporter identity.
// ---------------------------------------------------------------------------

const reportSchema = z.object({
  contentType: z.enum(["moment", "drop", "message", "profile", "announcement", "plan"]),
  contentId: uuidSchema,
  category: z.string(),
  details: z.string().max(1000).optional(),
  alsoHide: z.boolean().optional(),
  alsoBlock: z.boolean().optional()
});

export async function reportContentAction(input: unknown): Promise<MomentActionState> {
  const missing = missingEnvState();
  if (missing) return missing;

  const parsed = reportSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Check the report details and try again." };
  if (!isReportCategory(parsed.data.category)) return { ok: false, message: "Choose a report reason." };

  const userId = await getAuthedUserId();
  if (!userId) return { ok: false, message: "Log in first." };

  const rateLimit = await consumeRateLimit({ action: "content.report", userId });
  if (!rateLimit.allowed) return { ok: false, message: rateLimitMessage(rateLimit.resetAt) };

  const admin = createSupabaseAdminClient();

  // Resolve the reported author where we can, so moderation has context.
  let reportedUserId: string | null = null;
  if (parsed.data.contentType === "moment") {
    const { data } = await admin.from("moments").select("author_id").eq("id", parsed.data.contentId).maybeSingle();
    reportedUserId = data?.author_id ?? null;
  } else if (parsed.data.contentType === "drop") {
    const { data } = await admin
      .from("muddy_drops")
      .select("creator_id")
      .eq("id", parsed.data.contentId)
      .maybeSingle();
    reportedUserId = data?.creator_id ?? null;
  }

  const { error } = await admin.from("content_reports").insert({
    reporter_id: userId,
    content_type: parsed.data.contentType as ReportableContentType,
    content_id: parsed.data.contentId,
    reported_user_id: reportedUserId,
    category: parsed.data.category,
    details: parsed.data.details?.trim() || null,
    // Serious categories go straight to human review (§54).
    status: requiresHumanReview(parsed.data.category) ? "under_review" : "received"
  });
  if (error) return { ok: false, message: "Couldn't submit that report." };

  // Content hides from the reporter immediately (§50), regardless of outcome.
  await hideContentForUser(admin, userId, parsed.data.contentType, parsed.data.contentId);

  if (parsed.data.alsoBlock && reportedUserId && reportedUserId !== userId) {
    await admin
      .from("blocked_users")
      .upsert({ blocker_id: userId, blocked_id: reportedUserId }, { onConflict: "blocker_id,blocked_id" });
  }

  return { ok: true, message: REPORT_CONFIRMATION_MESSAGE };
}

/** Client-side preflight so the warning can show before posting (spec §7, §55). */
export async function checkLocationRiskAction(text: string): Promise<{ warn: boolean; message: string | null }> {
  const risk = detectLocationRisk(text ?? "");
  return { warn: risk.warn, message: risk.warn ? LOCATION_WARNING_MESSAGE : null };
}
