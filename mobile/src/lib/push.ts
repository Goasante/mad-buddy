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

  let status = (await PushNotifications.checkPermissions()).receive;
  if (status === "prompt" || status === "prompt-with-rationale") {
    status = (await PushNotifications.requestPermissions()).receive;
  }
  if (status !== "granted") return;

  registered = true;

  await PushNotifications.addListener("registration", (token) => {
    lastToken = token.value;
    void api.post("/api/push/register", { token: token.value, platform });
  });
  await PushNotifications.addListener("registrationError", () => {
    registered = false;
  });

  await PushNotifications.register();
}

/** Best-effort removal of this device's token on sign-out. */
export async function removeCurrentDeviceToken(): Promise<void> {
  if (!Capacitor.isNativePlatform() || !lastToken) return;
  await api.del("/api/push/register", { token: lastToken });
  lastToken = null;
  registered = false;
}
