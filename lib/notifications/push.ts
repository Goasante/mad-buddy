import "server-only";

import type { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { logBackendEvent } from "@/lib/observability/logger";
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
    const { data: subscriptions } = await admin
      .from("push_subscriptions")
      .select("id, endpoint, p256dh, auth")
      .eq("user_id", userId);
    if (!subscriptions?.length) return;

    const webPush = (await import("web-push")).default;
    webPush.setVapidDetails(
      vapid.subject,
      vapid.publicKey,
      vapid.privateKey
    );

    await Promise.all(
      subscriptions.map(async (subscription) => {
        try {
          await webPush.sendNotification(
            {
              endpoint: subscription.endpoint,
              keys: { p256dh: subscription.p256dh, auth: subscription.auth }
            },
            JSON.stringify(payload),
            { TTL: 60 * 60 }
          );
        } catch (error) {
          const statusCode = (error as { statusCode?: number }).statusCode;
          if (statusCode === 404 || statusCode === 410) {
            await admin.from("push_subscriptions").delete().eq("id", subscription.id);
          }
        }
      })
    );
  } catch {
    // Push is best-effort by design.
  }
}
