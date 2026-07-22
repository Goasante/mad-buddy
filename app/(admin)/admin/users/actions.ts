"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getAdminAccess, requireAdminPermission } from "@/lib/admin/access";
import { recordAdminAuditEvent } from "@/lib/admin/service";
import { deliverNotification } from "@/lib/notifications/server";
import { requireSafetyAdmin } from "@/lib/safety/admin";
import { consumeRateLimit, rateLimitMessage } from "@/lib/security/rate-limit";
import { backfillProfileForAuthUser } from "@/lib/admin/orphan-accounts";

export type CreateProfileState = { ok: boolean; message: string };

const schema = z.object({ userId: z.string().uuid() });

/**
 * Backfill the missing `profiles` row for an auth account surfaced by the
 * orphan-accounts safeguard. Same guards as any repair: session-resolved actor,
 * per-permission check, rate limit, and audit-first (an unlogged repair is worse
 * than a failed one).
 */
export async function createMissingProfileAction(input: unknown): Promise<CreateProfileState> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Choose a valid account." };

  try {
    const { admin, context } = await requireSafetyAdmin();
    await requireAdminPermission(admin, context, "admin.support.manage");
    const limit = await consumeRateLimit({ action: "admin.mutate", userId: context.userId });
    if (!limit.allowed) return { ok: false, message: rateLimitMessage(limit.resetAt) };

    const logged = await recordAdminAuditEvent(admin, {
      actorId: context.userId,
      action: "repair:create_missing_profile",
      targetType: "user",
      targetId: parsed.data.userId,
      newState: { reason: "Backfill profile for auth account with no profile row" },
      reason: "Backfill missing profile row"
    });
    if (!logged) return { ok: false, message: "The audit entry could not be recorded, so no change was made." };

    const result = await backfillProfileForAuthUser(admin, parsed.data.userId);
    if (result.ok) revalidatePath("/admin/users");
    return result;
  } catch {
    return { ok: false, message: "You don't have permission to do this." };
  }
}

// ---------------------------------------------------------------------------
// Direct staff message — a one-way, non-replyable notification sent to a user.
// The sender's tier decides the tag: support → "Support", owner/admin →
// "Mad Buddy core team". Gated on admin.support.manage (all three tiers have it).
// ---------------------------------------------------------------------------
export type StaffMessageState = { ok: boolean; message: string };

const staffMessageSchema = z.object({
  userId: z.string().uuid(),
  message: z.string().trim().min(2).max(1000)
});

export async function sendStaffMessageAction(input: unknown): Promise<StaffMessageState> {
  const parsed = staffMessageSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Write a message (2–1000 characters)." };

  try {
    const { admin, context } = await requireSafetyAdmin();
    await requireAdminPermission(admin, context, "admin.support.manage");
    const access = await getAdminAccess(admin, context);
    const limit = await consumeRateLimit({ action: "admin.mutate", userId: context.userId });
    if (!limit.allowed) return { ok: false, message: rateLimitMessage(limit.resetAt) };

    const { data: profile } = await admin
      .from("profiles")
      .select("user_id, deleted_at")
      .eq("user_id", parsed.data.userId)
      .maybeSingle();
    if (!profile || profile.deleted_at) return { ok: false, message: "That account is unavailable." };

    const isSupport = access.role === "support";
    const tag = isSupport ? "Support" : "Mad Buddy core team";
    const type = isSupport ? "staff_message:support" : "staff_message:core_team";

    const logged = await recordAdminAuditEvent(admin, {
      actorId: context.userId,
      action: "staff_message_sent",
      targetType: "user",
      targetId: parsed.data.userId,
      newState: { tag, length: parsed.data.message.length },
      reason: "Direct staff message"
    });
    if (!logged) return { ok: false, message: "The audit entry could not be recorded, so nothing was sent." };

    // Appears in the user's Pulse as a high-priority notification. It carries no
    // reply affordance (not a meetup_request / conversation), so it's one-way.
    await deliverNotification(admin, {
      userId: parsed.data.userId,
      senderId: context.userId,
      type,
      priority: "high",
      title: tag,
      message: parsed.data.message.trim()
    });

    return { ok: true, message: `Message sent as “${tag}”.` };
  } catch {
    return { ok: false, message: "You don't have permission to message users." };
  }
}
