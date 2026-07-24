"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdminPermission } from "@/lib/admin/access";
import { recordAdminAuditEvent } from "@/lib/admin/service";
import { OPEN_MOMENTS_FLAG } from "@/lib/features/feature-flags";
import { consumeRateLimit, rateLimitMessage } from "@/lib/security/rate-limit";
import { requireSafetyAdmin } from "@/lib/safety/admin";

export type FeatureFlagActionState = { ok: boolean; message: string };

const schema = z.object({
  key: z.literal(OPEN_MOMENTS_FLAG),
  enabled: z.boolean(),
  reason: z.string().trim().min(3).max(500)
});

export async function setFeatureFlagAction(input: unknown): Promise<FeatureFlagActionState> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Add a short reason for this change." };

  let auth: Awaited<ReturnType<typeof requireSafetyAdmin>>;
  try {
    auth = await requireSafetyAdmin();
    await requireAdminPermission(auth.admin, auth.context, "admin.feature_flags.manage");
  } catch {
    return { ok: false, message: "You don't have permission to change feature controls." };
  }

  const limit = await consumeRateLimit({ action: "admin.mutate", userId: auth.context.userId });
  if (!limit.allowed) return { ok: false, message: rateLimitMessage(limit.resetAt) };

  const { data: current } = await auth.admin
    .from("feature_flags")
    .select("id, status, default_value")
    .eq("key", parsed.data.key)
    .maybeSingle();
  if (!current) return { ok: false, message: "That feature control is unavailable." };

  const nextStatus = parsed.data.enabled ? "on" : "off";
  const logged = await recordAdminAuditEvent(auth.admin, {
    actorId: auth.context.userId,
    actorRole: auth.context.email,
    action: parsed.data.enabled ? "feature_flag_enabled" : "feature_flag_disabled",
    targetType: "feature_flag",
    targetId: current.id,
    previousState: { key: parsed.data.key, status: current.status, defaultValue: current.default_value },
    newState: { key: parsed.data.key, status: nextStatus, defaultValue: parsed.data.enabled },
    reason: parsed.data.reason
  });
  if (!logged) {
    return { ok: false, message: "The audit entry could not be recorded, so nothing was changed." };
  }

  const { error } = await auth.admin
    .from("feature_flags")
    .update({
      status: nextStatus,
      default_value: parsed.data.enabled,
      updated_at: new Date().toISOString()
    })
    .eq("id", current.id);
  if (error) return { ok: false, message: "The feature control could not be updated." };

  revalidatePath("/admin/features");
  revalidatePath("/moments");
  return {
    ok: true,
    message: parsed.data.enabled ? "Open Moments enabled." : "Open Moments disabled."
  };
}
