"use server";

import { z } from "zod";
import { contentTierLimitsFor, resolveDropUnlock, validateExpiry } from "@/lib/content/moments";
import { signMediaForAsset } from "@/lib/content/service";
import { createNotification } from "@/lib/notifications/server";
import { getCurrentSubscriptionAccess } from "@/lib/premium/access";
import { consumeRateLimit, rateLimitMessage } from "@/lib/security/rate-limit";
import { areApprovedMuddies, isBlockedEitherDirection } from "@/lib/social/permissions";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSupabaseServerEnv } from "@/lib/supabase/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { DropContextType, DropType } from "@/lib/supabase/database.types";

export type DropActionState = {
  ok: boolean;
  message: string;
  dropId?: string;
};

export type UnlockedDrop = {
  id: string;
  creatorName: string;
  contentType: "text" | "photo";
  textContent: string | null;
  mediaUrl: string | null;
  actionType: string | null;
  actionTargetId: string | null;
  expiresAt: string;
};

const uuidSchema = z.string().uuid();
type Admin = ReturnType<typeof createSupabaseAdminClient>;

function missingEnvState(): DropActionState | null {
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

/**
 * Does the user belong to a Drop's context, and is that context still valid?
 * (spec §25, §31, §33). Membership is always re-resolved server-side.
 */
async function resolveContextMembership(
  admin: Admin,
  userId: string,
  contextType: DropContextType,
  contextId: string
): Promise<{ inContext: boolean; contextValid: boolean }> {
  switch (contextType) {
    case "circle": {
      const { data: circle } = await admin
        .from("friend_circles")
        .select("id, user_id, archived_at")
        .eq("id", contextId)
        .maybeSingle();
      if (!circle || circle.archived_at) return { inContext: false, contextValid: false };
      if (circle.user_id === userId) return { inContext: true, contextValid: true };
      const { data: member } = await admin
        .from("circle_members")
        .select("id")
        .eq("circle_id", contextId)
        .eq("friend_id", userId)
        .maybeSingle();
      return { inContext: Boolean(member), contextValid: true };
    }
    case "plan": {
      const { data: plan } = await admin.from("plans").select("id, status").eq("id", contextId).maybeSingle();
      const contextValid = Boolean(plan) && plan!.status !== "cancelled" && plan!.status !== "expired";
      if (!contextValid) return { inContext: false, contextValid: false };
      const { data: participant } = await admin
        .from("plan_participants")
        .select("id")
        .eq("plan_id", contextId)
        .eq("user_id", userId)
        .neq("rsvp_status", "removed")
        .maybeSingle();
      return { inContext: Boolean(participant), contextValid: true };
    }
    case "event": {
      const { data: event } = await admin.from("events").select("id, status").eq("id", contextId).maybeSingle();
      const contextValid = Boolean(event) && event!.status !== "cancelled";
      if (!contextValid) return { inContext: false, contextValid: false };
      // An Event Drop unlocks on a live check-in (spec §22).
      const { data: checkIn } = await admin
        .from("check_ins")
        .select("id")
        .eq("user_id", userId)
        .eq("context_type", "event")
        .eq("context_id", contextId)
        .eq("status", "checked_in")
        .maybeSingle();
      return { inContext: Boolean(checkIn), contextValid: true };
    }
    case "event_circle": {
      const { data: circle } = await admin
        .from("event_circles")
        .select("id, status")
        .eq("id", contextId)
        .maybeSingle();
      const contextValid = Boolean(circle) && circle!.status !== "archived" && circle!.status !== "deleted";
      if (!contextValid) return { inContext: false, contextValid: false };
      const { data: member } = await admin
        .from("event_circle_members")
        .select("id")
        .eq("event_circle_id", contextId)
        .eq("user_id", userId)
        .eq("status", "joined")
        .maybeSingle();
      return { inContext: Boolean(member), contextValid: true };
    }
    default:
      return { inContext: false, contextValid: false };
  }
}

// ---------------------------------------------------------------------------
// Create (spec §24, §31, §32)
// ---------------------------------------------------------------------------

const createDropSchema = z.object({
  dropType: z.enum(["circle", "plan", "event"]),
  contextType: z.enum(["circle", "plan", "event", "event_circle"]),
  contextId: uuidSchema,
  contentType: z.enum(["text", "photo"]),
  textContent: z.string().max(500).optional(),
  mediaId: uuidSchema.optional(),
  actionType: z.enum(["open_chat", "join_plan", "wave", "rsvp", "view_announcement"]).optional(),
  startsAt: z.string().datetime({ offset: true }).optional(),
  expiresAt: z.string().datetime({ offset: true }),
  maxUnlocks: z.number().int().min(1).max(1000).optional()
});

export async function createDropAction(input: unknown): Promise<DropActionState> {
  const missing = missingEnvState();
  if (missing) return missing;

  const parsed = createDropSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Check the Drop details and try again." };

  if (parsed.data.contentType === "text" && !parsed.data.textContent?.trim()) {
    return { ok: false, message: "Write something to drop." };
  }
  if (parsed.data.contentType === "photo" && !parsed.data.mediaId) {
    return { ok: false, message: "Choose a photo." };
  }

  const nowMs = Date.now();
  const expiryError = validateExpiry(Date.parse(parsed.data.expiresAt), nowMs);
  if (expiryError) return { ok: false, message: expiryError };

  const userId = await getAuthedUserId();
  if (!userId) return { ok: false, message: "Log in before creating a Drop." };

  const rateLimit = await consumeRateLimit({ action: "drops.create", userId });
  if (!rateLimit.allowed) return { ok: false, message: rateLimitMessage(rateLimit.resetAt) };

  const admin = createSupabaseAdminClient();
  const access = await getCurrentSubscriptionAccess(userId);
  const limits = contentTierLimitsFor(access.plan);

  if (parsed.data.dropType === "event" && !limits.allowEventDrops) {
    return { ok: false, message: "Event Drops are a Buddy Plus feature." };
  }

  const { count: activeDrops } = await admin
    .from("muddy_drops")
    .select("id", { count: "exact", head: true })
    .eq("creator_id", userId)
    .in("status", ["scheduled", "active"])
    .gt("expires_at", new Date(nowMs).toISOString());
  if ((activeDrops ?? 0) >= limits.maxActiveDrops) {
    return {
      ok: false,
      message:
        access.plan === "free"
          ? "Free plan allows 3 active Drops. Upgrade for more."
          : "You've reached your active Drop limit."
    };
  }

  // You may only attach a Drop to a context you belong to (spec §31).
  const membership = await resolveContextMembership(admin, userId, parsed.data.contextType, parsed.data.contextId);
  if (!membership.contextValid || !membership.inContext) {
    return { ok: false, message: "You can't add a Drop to that." };
  }

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

  const { data: drop, error } = await admin
    .from("muddy_drops")
    .insert({
      creator_id: userId,
      drop_type: parsed.data.dropType as DropType,
      context_type: parsed.data.contextType as DropContextType,
      context_id: parsed.data.contextId,
      content_type: parsed.data.contentType,
      text_content: parsed.data.textContent?.trim() || null,
      media_id: parsed.data.mediaId ?? null,
      action_type: parsed.data.actionType ?? null,
      status: "active",
      starts_at: parsed.data.startsAt ?? new Date(nowMs).toISOString(),
      expires_at: parsed.data.expiresAt,
      max_unlocks: parsed.data.maxUnlocks ?? null
    })
    .select("id")
    .single();
  if (error || !drop) return { ok: false, message: "Couldn't create that Drop." };

  return { ok: true, message: "Drop created.", dropId: drop.id };
}

// ---------------------------------------------------------------------------
// Unlock (spec §25, §28, §33)
// ---------------------------------------------------------------------------

export async function unlockDropAction(dropId: string): Promise<DropActionState> {
  const missing = missingEnvState();
  if (missing) return missing;
  if (!uuidSchema.safeParse(dropId).success) return { ok: false, message: "Drop not found." };

  const userId = await getAuthedUserId();
  if (!userId) return { ok: false, message: "Log in first." };

  const rateLimit = await consumeRateLimit({ action: "drops.unlock", userId });
  if (!rateLimit.allowed) return { ok: false, message: rateLimitMessage(rateLimit.resetAt) };

  const admin = createSupabaseAdminClient();
  const { data: drop } = await admin
    .from("muddy_drops")
    .select("id, creator_id, context_type, context_id, status, starts_at, expires_at, max_unlocks")
    .eq("id", dropId)
    .maybeSingle();

  // A Drop's existence must never leak to an ineligible user (spec §25), so
  // every denial below returns the same "not found" as a missing Drop.
  const notFound: DropActionState = { ok: false, message: "Drop not found." };
  if (!drop) return notFound;

  const isCreator = drop.creator_id === userId;
  const [mutual, blocked, membership, { count: unlockCount }, { data: existing }] = await Promise.all([
    isCreator ? Promise.resolve(true) : areApprovedMuddies(admin, drop.creator_id, userId),
    isCreator ? Promise.resolve(false) : isBlockedEitherDirection(admin, drop.creator_id, userId),
    resolveContextMembership(admin, userId, drop.context_type, drop.context_id),
    admin.from("drop_unlocks").select("id", { count: "exact", head: true }).eq("drop_id", dropId),
    admin.from("drop_unlocks").select("id").eq("drop_id", dropId).eq("user_id", userId).maybeSingle()
  ]);

  const decision = resolveDropUnlock({
    status: drop.status,
    startsAtMs: Date.parse(drop.starts_at),
    expiresAtMs: Date.parse(drop.expires_at),
    nowMs: Date.now(),
    areApprovedMuddiesWithCreator: mutual,
    isBlockedEitherDirection: blocked,
    viewerInContext: membership.inContext,
    contextValid: membership.contextValid,
    alreadyUnlocked: Boolean(existing),
    unlockCount: unlockCount ?? 0,
    maxUnlocks: drop.max_unlocks
  });

  if (!decision.allowed) return notFound;
  if (decision.reason === "already_unlocked") return { ok: true, message: "Drop unlocked.", dropId };

  // The unique (drop_id, user_id) constraint makes a concurrent duplicate a
  // conflict rather than a second unlock (spec §33).
  const { error } = await admin
    .from("drop_unlocks")
    .upsert({ drop_id: dropId, user_id: userId }, { onConflict: "drop_id,user_id", ignoreDuplicates: true });
  if (error) return { ok: false, message: "Couldn't unlock that Drop." };

  if (!isCreator) {
    const { data: profile } = await admin.from("profiles").select("full_name").eq("user_id", userId).maybeSingle();
    await createNotification(admin, {
      userId: drop.creator_id,
      type: "moment:drop_unlocked",
      title: "Drop unlocked",
      message: `${profile?.full_name?.trim() || "A Muddy"} unlocked your Drop.`
    });
  }

  return { ok: true, message: "Drop unlocked.", dropId };
}

/** Content of a Drop the user has already unlocked (spec §28). */
export async function getUnlockedDropAction(dropId: string): Promise<UnlockedDrop | null> {
  const env = getSupabaseServerEnv();
  if (!env.url || !env.serviceRoleKey) return null;
  if (!uuidSchema.safeParse(dropId).success) return null;

  const userId = await getAuthedUserId();
  if (!userId) return null;

  const admin = createSupabaseAdminClient();
  const { data: unlock } = await admin
    .from("drop_unlocks")
    .select("id")
    .eq("drop_id", dropId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!unlock) return null; // Never reveal content that wasn't unlocked.

  const { data: drop } = await admin
    .from("muddy_drops")
    .select("id, creator_id, content_type, text_content, media_id, action_type, action_target_id, expires_at, status")
    .eq("id", dropId)
    .maybeSingle();
  if (!drop || drop.status === "removed" || Date.parse(drop.expires_at) <= Date.now()) return null;

  const { data: profile } = await admin
    .from("profiles")
    .select("full_name")
    .eq("user_id", drop.creator_id)
    .maybeSingle();

  await admin
    .from("drop_unlocks")
    .update({ viewed_at: new Date().toISOString() })
    .eq("drop_id", dropId)
    .eq("user_id", userId)
    .is("viewed_at", null);

  return {
    id: drop.id,
    creatorName: profile?.full_name?.trim() || "A Muddy",
    contentType: drop.content_type,
    textContent: drop.text_content,
    mediaUrl: drop.media_id ? await signMediaForAsset(admin, drop.media_id, "feed") : null,
    actionType: drop.action_type,
    actionTargetId: drop.action_target_id,
    expiresAt: drop.expires_at
  };
}
