import { Capacitor } from "@capacitor/core";
import { PushNotifications } from "@capacitor/push-notifications";
import { api } from "./api";

/**
 * Native push registration. No-ops on web (Capacitor.isNativePlatform() is
 * false), so the same SPA build runs everywhere. On device it requests
 * permission, registers with FCM/APNs, and posts the token to
 * /api/push/register. The `registered` guard keeps StrictMode's double-mount
 * (and repeated auth changes) from stacking listeners.
 */

let registered = false;
let lastToken: string | null = null;

export async function registerPushNotifications(): Promise<void> {
  if (!Capacitor.isNativePlatform() || registered) return;

  const platform = Capacitor.getPlatform();
  if (platform !== "android" && platform !== "ios") return;

  /* EVERY native call here is inside the try, and that is the point.
     PushNotifications.register() throws a NATIVE exception when FCM cannot
     start -- most sharply "Default FirebaseApp is not initialized in this
     process", which is what a build missing google-services.json does at
     runtime. The Java exception crosses the Capacitor bridge as a rejected
     promise, and because the only caller is a fire-and-forget
     `void registerPushNotifications()` in AuthProvider, nothing was there to
     catch it: the app died on the CapacitorPlugins thread immediately after
     sign-in, which is the moment registration runs.

     Notifications are an enhancement. Failing to register one must never take
     the app down -- the person still has every other feature. So this reports
     and returns instead of propagating. */
  try {
    let status = (await PushNotifications.checkPermissions()).receive;
    if (status === "prompt" || status === "prompt-with-rationale") {
      status = (await PushNotifications.requestPermissions()).receive;
    }
    if (status !== "granted") return;

    // Set only after the guards pass, so a throw below can be retried on the
    // next auth change rather than being latched off by this flag.
    registered = true;

    await PushNotifications.addListener("registration", (token) => {
      lastToken = token.value;
      void api.post("/api/push/register", { token: token.value, platform });
    });
    await PushNotifications.addListener("registrationError", () => {
      registered = false;
    });

    await PushNotifications.register();
  } catch (error) {
    registered = false;
    console.warn("Push registration unavailable; continuing without it.", error);
  }
}

/**
 * Best-effort removal of this device's token on sign-out.
 *
 * "Best-effort" is load-bearing: signOut() awaits this BEFORE
 * supabase.auth.signOut(), so letting a failure here propagate would leave
 * the person unable to sign out at all -- a far worse outcome than a stale
 * token row, which the server can reap when a send fails. The local state is
 * cleared either way so the next sign-in re-registers cleanly.
 */
export async function removeCurrentDeviceToken(): Promise<void> {
  if (!Capacitor.isNativePlatform() || !lastToken) return;
  try {
    await api.del("/api/push/register", { token: lastToken });
  } catch (error) {
    console.warn("Could not remove this device's push token.", error);
  } finally {
    lastToken = null;
    registered = false;
  }
}
