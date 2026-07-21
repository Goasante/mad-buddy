import "server-only";

import { z } from "zod";
import { errorType, logBackendEvent } from "@/lib/observability/logger";
import { consumeRateLimit, rateLimitMessage } from "@/lib/security/rate-limit";
import {
  ACTIVITY_TYPES,
  AVAILABILITY_TYPES,
  STATUS_MAX_TEXT_LENGTH,
  validateStatusExpiry
} from "@/lib/social/rules";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSupabaseServerEnv } from "@/lib/supabase/env";

/**
 * Transport-agnostic Muddy Status service (Home glow). Takes an
 * already-authenticated `userId`; shared by the web Server Actions
 * (`setStatusAction`/`clearStatusAction`) and the mobile `/api/status` route.
 */

export type ServiceResult = { ok: boolean; message: string };

export const statusSchema = z.object({
  availabilityType: z.enum(AVAILABILITY_TYPES as [string, ...string[]]),
  activityType: z.enum(ACTIVITY_TYPES as [string, ...string[]]).nullable().optional(),
  customText: z.string().trim().max(STATUS_MAX_TEXT_LENGTH).optional(),
  expiresAt: z.string().datetime({ offset: true })
});

function serviceRoleEnvMessage(): string | null {
  const env = getSupabaseServerEnv();
  if (!env.url || !env.serviceRoleKey) {
    return "This action needs the server database configuration.";
  }
  return null;
}

export async function setStatus(userId: string, input: unknown): Promise<ServiceResult> {
  const envMessage = serviceRoleEnvMessage();
  if (envMessage) return { ok: false, message: envMessage };

  const parsed = statusSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: "Check your status details and try again." };
  }

  // Server time is the source of truth (spec §13).
  const now = Date.now();
  const expiresAtMs = Date.parse(parsed.data.expiresAt);
  const expiryError = validateStatusExpiry(expiresAtMs, now);
  if (expiryError) return { ok: false, message: expiryError };

  const rate = await consumeRateLimit({ action: "status.update", userId });
  if (!rate.allowed) return { ok: false, message: rateLimitMessage(rate.resetAt) };

  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("user_statuses").upsert(
    {
      user_id: userId,
      availability_type: parsed.data.availabilityType as never,
      activity_type: (parsed.data.activityType ?? null) as never,
      custom_text: parsed.data.customText || null,
      visibility_type: "all_muddies",
      starts_at: new Date(now).toISOString(),
      expires_at: new Date(expiresAtMs).toISOString(),
      updated_at: new Date(now).toISOString()
    },
    { onConflict: "user_id" }
  );

  if (error) {
    logBackendEvent("warn", { action: "status.set", userId, errorType: errorType(error) });
    return { ok: false, message: "Couldn't save your status. Try again." };
  }

  const { recordMilestone } = await import("@/lib/onboarding/service");
  await recordMilestone(admin, userId, "first_status_created");

  const until = new Date(expiresAtMs).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return { ok: true, message: `Status updated. Your Muddies can see it until ${until}.` };
}

export async function clearStatus(userId: string): Promise<ServiceResult> {
  const envMessage = serviceRoleEnvMessage();
  if (envMessage) return { ok: false, message: envMessage };

  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("user_statuses").delete().eq("user_id", userId);

  if (error) {
    return { ok: false, message: "Couldn't clear your status. Try again." };
  }
  return { ok: true, message: "Status cleared." };
}
