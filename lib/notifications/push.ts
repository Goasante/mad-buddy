import "server-only";

import type { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { errorType, logBackendEvent } from "@/lib/observability/logger";
import { readVapidConfiguration } from "@/lib/notifications/vapid";

type SupabaseAdmin = ReturnType<typeof createSupabaseAdminClient>;

/**
 * Web push transport (batch 4 deferred). Fails safe in every direction:
 * missing VAPID env → silent no-op (in-app delivery is unaffected); a gone
 * endpoint (404/410) deletes its subscription row; any other error is
 * swallowed, a push failure must never fail the action that triggered it.
 *
 * Env: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto: or URL).
 * The client uses NEXT_PUBLIC_VAPID_PUBLIC_KEY (same value as VAPID_PUBLIC_KEY).
 */
export function vapidConfigured(): boolean {
  return readVapidConfiguration(process.env).ok;
}

export async function sendPushToUser(
  admin: SupabaseAdmin,
  userId: string,
  payload: { title: string; body: string; url?: string }
): Promise<void> {
  const vapid = readVapidConfiguration(process.env);
  if (!vapid.ok) {
    if (process.env.NODE_ENV === "production") {
      logBackendEvent("error", {
        action: "notifications.web_push",
        statusCode: 503,
        userId,
        errorType: vapid.mismatch
          ? "vapid_public_key_mismatch"
          : `missing_vapid_configuration:${vapid.missing.join(",")}`
      });
    }
    return;
  }

  try {
    const { data: subscriptions, error: subscriptionError } = await admin
      .from("push_subscriptions")
      .select("id, endpoint, p256dh, auth")
      .eq("user_id", userId);

    if (subscriptionError) {
      logBackendEvent("warn", {
        action: "notifications.web_push.subscription_read",
        statusCode: 500,
        userId,
        errorType: errorType(subscriptionError)
      });
      return;
    }

    if (!subscriptions?.length) {
      logBackendEvent("info", {
        action: "notifications.web_push.delivery",
        statusCode: 204,
        userId,
        errorType: "no_subscription"
      });
      return;
    }

    const webPush = (await import("web-push")).default;
    webPush.setVapidDetails(vapid.subject, vapid.publicKey, vapid.privateKey);

    let delivered = 0;
    let stale = 0;
    let failed = 0;

    await Promise.all(
      subscriptions.map(async (subscription) => {
        try {
          await webPush.sendNotification(
            {
              endpoint: subscription.endpoint,
              keys: { p256dh: subscription.p256dh, auth: subscription.auth }
            },
            JSON.stringify(payload),
            { TTL: 60 * 60, timeout: 10_000 }
          );
          delivered += 1;
        } catch (caught) {
          const statusCode = (caught as { statusCode?: number }).statusCode;
          if (statusCode === 404 || statusCode === 410) {
            stale += 1;
            await admin.from("push_subscriptions").delete().eq("id", subscription.id);
            return;
          }
          failed += 1;
        }
      })
    );

    logBackendEvent(failed > 0 ? "warn" : "info", {
      action: "notifications.web_push.delivery",
      statusCode: failed > 0 ? 207 : delivered > 0 ? 200 : 410,
      userId,
      errorType:
        failed > 0
          ? "partial_delivery_failure"
          : delivered === 0 && stale > 0
            ? "stale_subscriptions_pruned"
            : undefined
    });
  } catch (caught) {
    logBackendEvent("warn", {
      action: "notifications.web_push.delivery",
      statusCode: 502,
      userId,
      errorType: errorType(caught)
    });
  }
}
