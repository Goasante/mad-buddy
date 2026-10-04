
import { featureForNotification } from "@/lib/features/availability";

import { optionalFeatureEnabled } from "@/lib/features/availability-server";
import "server-only";
import { z } from "zod";

import type { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { errorType, logBackendEvent } from "@/lib/observability/logger";
import { sendWebPushTarget } from "./push";
import { sendNativePushTarget } from "./fcm";
import { decideNotification, isWithinQuietHours, normalizePreferences, minuteOfDayInTimeZone,
  DEFAULT_RECIPIENT_TIMEZONE, DEFAULT_NOTIFICATION_PREFERENCES, type NotificationCategory, type NotificationPriority } from "./preferences";
import { applyEngagementGuards } from "@/lib/engagement/rules";

type Admin = ReturnType<typeof createSupabaseAdminClient>;
type Claim = {
  id: string; dispatch_id: string; transport: string; target_id: string;
  attempts: number; lease_id: string; user_id: string;
  payload: unknown; context: unknown; expires_at: string;
};
const categories = Object.keys(DEFAULT_NOTIFICATION_PREFERENCES.categories);
const contextSchema = z.object({
  priority: z.enum(["critical", "high", "normal", "low"]).default("normal"),
  category: z.enum(["waves", "pings", "proximity", "plans", "status", "birthdays", "conference"]).nullish(),
  senderId: z.string().uuid().nullish(), type: z.string().optional()
});

/** Recheck preferences on retries; a queued push must not override a new mute. */
async function pushStillAllowed(admin: Admin, row: Claim): Promise<boolean> {
  const releaseContext = contextSchema.parse(row.context);
  const releaseFeature = featureForNotification(releaseContext.type ?? "");
  if (releaseFeature && !(await optionalFeatureEnabled(releaseFeature))) return false;

  const context = contextSchema.parse(row.context);
  const priority = (context.priority ?? "normal") as NotificationPriority;
  const [prefs, engagement, closeFriend, blocked, deletion] = await Promise.all([
    admin.from("user_preferences").select("notification_preferences").eq("user_id", row.user_id).maybeSingle(),
    admin.from("engagement_preferences").select("exam_mode_until, exam_mode_allow_close_friends").eq("user_id", row.user_id).maybeSingle(),
    context.senderId ? admin.from("close_friend_relationships").select("id")
      .eq("owner_id", row.user_id).eq("friend_id", context.senderId).maybeSingle() : Promise.resolve({ data: null, error: null }),
    context.senderId ? admin.from("blocked_users").select("id")
      .or(`and(blocker_id.eq.${row.user_id},blocked_id.eq.${context.senderId}),and(blocker_id.eq.${context.senderId},blocked_id.eq.${row.user_id})`)
      .limit(1) : Promise.resolve({ data: [], error: null }),
    admin.from("account_deletion_requests").select("user_id").eq("user_id", row.user_id).maybeSingle()
  ]);
  for (const result of [prefs, engagement, closeFriend, blocked, deletion]) if (result.error) throw result.error;
  if (blocked.data?.length || deletion.data) return false;
  const preference = normalizePreferences(prefs.data?.notification_preferences);
  const minute = minuteOfDayInTimeZone(new Date(), DEFAULT_RECIPIENT_TIMEZONE);
  const decision = context.category && categories.includes(context.category)
    ? decideNotification(preference, { category: context.category as NotificationCategory, priority,
      fromCloseFriend: Boolean(closeFriend.data), recipientLocalMinute: minute })
    : { inApp: true, push: priority === "critical" || !isWithinQuietHours(preference, minute), reason: "deliver" };
  // The budget was reserved atomically at enqueue, never reserve again.
  return applyEngagementGuards(decision, { priority,
    examModeUntilMs: engagement.data?.exam_mode_until ? Date.parse(engagement.data.exam_mode_until) : null,
    examModeAllowCloseFriends: engagement.data?.exam_mode_allow_close_friends ?? true,
    fromCloseFriend: Boolean(closeFriend.data), sentToday: 0, budget: 8, nowMs: Date.now() }).push;
}

export function classifyPushFailure(caught: unknown): "retry" | "failed" {
  const status = (caught as { statusCode?: number } | null)?.statusCode;
  const code = (caught as { code?: string } | null)?.code;
  // Bad credentials/configuration can be repaired while the delivery is live.
  // Only malformed payloads are permanently unprocessable here. Dead targets
  // are pruned by the transport and acknowledged without another retry.
  if (status === 400 || status === 413 || code === "messaging/invalid-argument") return "failed";
  return "retry";
}

async function deliverClaim(admin: Admin, row: Claim, permission: () => Promise<boolean>) {
  let outcome: "delivered" | "retry" | "failed" | "suppressed" = "delivered";
  let failure: string | null = null;
  try {
    const payload = row.payload as { title?: unknown; body?: unknown; url?: unknown };
    if (!payload || typeof payload.title !== "string" || typeof payload.body !== "string" || typeof payload.url !== "string"
      || !payload.url.startsWith("/") || payload.url.startsWith("//") || !contextSchema.safeParse(row.context).success) {
      outcome = "failed"; failure = "invalid_payload";
    } else if (Date.parse(row.expires_at) <= Date.now() || !(await permission())) {
      outcome = "suppressed";
    } else {
      const safe = { title: payload.title, body: payload.body, url: payload.url, tag: row.dispatch_id };
      if (row.transport === "web") {
        await sendWebPushTarget(admin, row.user_id, row.target_id, safe,
          Math.max(0, Math.floor((Date.parse(row.expires_at) - Date.now()) / 1000)));
      } else if (row.transport === "native") {
        await sendNativePushTarget(admin, row.user_id, row.target_id,
          { title: safe.title, body: safe.body, data: { url: safe.url } }, row.dispatch_id, row.expires_at);
      } else { outcome = "failed"; failure = "invalid_transport"; }
    }
  } catch (caught) {
    outcome = classifyPushFailure(caught);
    const provider = caught as { statusCode?: number; code?: string };
    failure = typeof provider?.statusCode === "number" ? `provider_status:${provider.statusCode}`
      : typeof provider?.code === "string" && provider.code.startsWith("messaging/") ? provider.code.slice(0, 80) : errorType(caught);
    logBackendEvent("warn", { action: "notifications.outbox.transport", userId: row.user_id, errorType: failure });
  }
  // Separate from the transport catch: an ack failure retains the lease.
  // This is at-least-once delivery. Stable notification tags reduce duplicate
  // display if the provider accepted a push just before the process died.
  const ack = await admin.rpc("finish_notification_push", {
    p_id: row.id, p_lease_id: row.lease_id, p_outcome: outcome, p_error: failure
  });
  if (ack.error) throw ack.error;
  if (!ack.data) throw new Error("PushLeaseLost");
}

/** Bounded, four concurrent devices. A lost immediate invocation is recovered
 * by the existing five-minute cron; acknowledged devices are never reclaimed.
 */
export async function drainPushOutbox(admin: Admin, dispatchId?: string) {
  const startedAt = Date.now();
  let handled = 0; let claimedCount = 0;
  const permissions = new Map<string, Promise<boolean>>();
  for (let batch = 0; batch < 5; batch += 1) {
    if (Date.now() - startedAt > 25_000) break;
    // Claim only the batch about to run; do not strand future rows under a
    // lease if this invocation runs out of time.
    const claimed = await admin.rpc("claim_notification_push", { p_dispatch_id: dispatchId ?? null, p_limit: 4 });
    if (claimed.error) throw claimed.error;
    const rows = (claimed.data ?? []) as Claim[];
    if (!rows.length) break;
    claimedCount += rows.length;
    const results = await Promise.allSettled(rows.map(row => deliverClaim(admin, row, () => {
      if (!permissions.has(row.dispatch_id)) permissions.set(row.dispatch_id, pushStillAllowed(admin, row));
      return permissions.get(row.dispatch_id)!;
    })));
    handled += results.filter(result => result.status === "fulfilled").length;
    for (const result of results) {
      if (result.status === "rejected") logBackendEvent("warn", {
        action: "notifications.outbox.ack", errorType: errorType(result.reason)
      });
    }
  }
  return { claimed: claimedCount, handled };
}
