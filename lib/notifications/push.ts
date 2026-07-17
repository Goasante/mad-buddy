import "server-only";

import type { createSupabaseAdminClient } from "@/lib/supabase/admin";

type SupabaseAdmin = ReturnType<typeof createSupabaseAdminClient>;

/**
 * Web push transport (batch 4 deferred). Fails safe in every direction:
 * missing VAPID env → silent no-op (in-app delivery is unaffected); a gone
 * endpoint (404/410) deletes its subscription row; any other error is
 * swallowed — a push failure must never fail the action that triggered it.
 *
 * Env: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto: or URL).
 * The client uses NEXT_PUBLIC_VAPID_PUBLIC_KEY (same value as VAPID_PUBLIC_KEY).
 */
export function vapidConfigured(): boolean {
  return Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

export async function sendPushToUser(
  admin: SupabaseAdmin,
  userId: string,
  payload: { title: string; body: string; url?: string }
): Promise<void> {
  if (!vapidConfigured()) return;

  try {
    const { data: subscriptions } = await admin
      .from("push_subscriptions")
      .select("id, endpoint, p256dh, auth")
      .eq("user_id", userId);
    if (!subscriptions?.length) return;

    const webPush = (await import("web-push")).default;
    webPush.setVapidDetails(
      process.env.VAPID_SUBJECT || "mailto:godfredasante0010@gmail.com",
      process.env.VAPID_PUBLIC_KEY as string,
      process.env.VAPID_PRIVATE_KEY as string
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
