import "server-only";

import { cert, getApps, initializeApp, type App } from "firebase-admin/app";
import { getMessaging } from "firebase-admin/messaging";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { errorType, logBackendEvent } from "@/lib/observability/logger";

/**
 * Native push (FCM/APNs) via the Firebase Admin SDK. Reads a base64-encoded
 * service-account JSON from FIREBASE_SERVICE_ACCOUNT_BASE64. When that env var
 * is absent or invalid, everything here silently no-ops, so web, tests, and
 * unconfigured environments are unaffected.
 *
 * Sending is hooked into deliverNotification, so any event that already reaches
 * a user in-app also pushes to their registered devices — no new call sites.
 */

const APP_NAME = "madbuddy-fcm";

type ServiceAccount = {
  project_id: string;
  client_email: string;
  private_key: string;
};

function loadServiceAccount(): ServiceAccount | null {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64;
  if (!raw) return null;
  try {
    const json = JSON.parse(Buffer.from(raw, "base64").toString("utf8")) as Partial<ServiceAccount>;
    if (!json.project_id || !json.client_email || !json.private_key) return null;
    return json as ServiceAccount;
  } catch {
    return null;
  }
}

/** True when a valid service account is configured. */
export function fcmConfigured(): boolean {
  return loadServiceAccount() !== null;
}

// Initialise the Admin app exactly once per process. getApps() guards against
// serverless warm-invocation and Next dev hot-reload re-initialisation.
function getFirebaseApp(): App | null {
  const serviceAccount = loadServiceAccount();
  if (!serviceAccount) return null;

  const existing = getApps().find((app) => app.name === APP_NAME);
  if (existing) return existing;

  return initializeApp(
    {
      credential: cert({
        projectId: serviceAccount.project_id,
        clientEmail: serviceAccount.client_email,
        privateKey: serviceAccount.private_key
      })
    },
    APP_NAME
  );
}

export type NativePushPayload = {
  title: string;
  body: string;
  data?: Record<string, string>;
};

/** One target per outbox row, so partial success never replays every device. */
export async function sendNativePushTarget(
  admin: ReturnType<typeof createSupabaseAdminClient>, userId: string, targetId: string,
  payload: NativePushPayload, dispatchId: string, expiresAt: string
): Promise<"delivered" | "gone"> {
  const app = getFirebaseApp();
  if (!app) throw Object.assign(new Error("Push configuration unavailable"), { name: "PushConfigurationUnavailable" });
  const { data: row, error } = await admin.from("device_push_tokens").select("token")
    .eq("id", targetId).eq("user_id", userId).maybeSingle();
  if (error) throw error;
  if (!row) return "gone";
  try {
    await getMessaging(app).send({
      token: row.token, notification: { title: payload.title, body: payload.body },
      data: { ...payload.data, dispatchId },
      android: { priority: "high", ttl: Math.max(0, Date.parse(expiresAt) - Date.now()),
        notification: { sound: "default", tag: dispatchId } },
      apns: { headers: { "apns-collapse-id": dispatchId,
        "apns-expiration": String(Math.floor(Date.parse(expiresAt) / 1000)) },
      payload: { aps: { sound: "default" } } }
    });
    return "delivered";
  } catch (caught) {
    const code = (caught as { code?: string }).code;
    if (code !== "messaging/registration-token-not-registered" && code !== "messaging/invalid-registration-token") throw caught;
    const removed = await admin.from("device_push_tokens").delete().eq("id", targetId)
      .eq("user_id", userId).eq("token", row.token);
    if (removed.error) throw removed.error;
    return "gone";
  }
}

/**
 * Sends a push to every device token registered for `userId`. Best-effort:
 * returns silently when unconfigured or the user has no devices, and prunes
 * tokens FCM reports as permanently dead so the table self-cleans.
 */
export async function sendNativePushToUser(userId: string, payload: NativePushPayload): Promise<void> {
  const app = getFirebaseApp();
  if (!app) return;

  const admin = createSupabaseAdminClient();
  const { data: rows, error: tokenError } = await admin.from("device_push_tokens").select("token").eq("user_id", userId);
  if (tokenError) {
    logBackendEvent("warn", {
      action: "notifications.native_push.token_read",
      statusCode: 500,
      userId,
      errorType: errorType(tokenError)
    });
    return;
  }

  const tokens = (rows ?? []).map((row) => row.token);
  if (tokens.length === 0) {
    logBackendEvent("info", {
      action: "notifications.native_push.delivery",
      statusCode: 204,
      userId,
      errorType: "no_device_token"
    });
    return;
  }

  let response;
  try {
    response = await getMessaging(app).sendEachForMulticast({
      tokens,
      notification: { title: payload.title, body: payload.body },
      data: payload.data,
      android: { priority: "high", notification: { sound: "default" } },
      apns: { payload: { aps: { sound: "default" } } }
    });
  } catch (caught) {
    logBackendEvent("warn", {
      action: "notifications.native_push.delivery",
      statusCode: 502,
      userId,
      errorType: errorType(caught)
    });
    return;
  }

  logBackendEvent(response.failureCount > 0 ? "warn" : "info", {
    action: "notifications.native_push.delivery",
    statusCode: response.failureCount > 0 ? 207 : 200,
    userId,
    errorType: response.failureCount > 0 ? "partial_delivery_failure" : undefined
  });

  // Prune tokens the transport says will never deliver again.
  const dead: string[] = [];
  response.responses.forEach((result, index) => {
    if (result.success) return;
    const code = result.error?.code;
    if (
      code === "messaging/registration-token-not-registered" ||
      code === "messaging/invalid-registration-token" ||
      code === "messaging/invalid-argument"
    ) {
      dead.push(tokens[index]);
    }
  });

  if (dead.length > 0) {
    await admin.from("device_push_tokens").delete().in("token", dead);
  }
}
