"use client";

import { useCallback, useEffect, useState } from "react";
import {
  deletePushSubscriptionAction,
  savePushSubscriptionAction
} from "@/app/(app)/push-actions";
import { isRequestTimeoutError, withTimeout } from "@/lib/network/resilience";

export type BrowserPushStatus =
  | "checking"
  | "unsupported"
  | "off"
  | "on"
  | "denied"
  | "error";

/**
 * Internal failure classification (never shown to users verbatim). Used to
 * decide the UX branch (denied vs. retryable failure) and for safe diagnostics.
 */
export type BrowserPushFailure =
  | "unsupported"
  | "permission_denied"
  | "permission_dismissed"
  | "service_worker_unavailable"
  | "service_worker_timeout"
  | "push_subscription_failed"
  | "subscription_persist_failed"
  | "unknown";

export type EnablePushResult = {
  ok: boolean;
  permission: NotificationPermission | "unsupported";
  code?: BrowserPushFailure;
  message?: string;
};

const SERVICE_WORKER_READY_TIMEOUT_MS = 10_000;

function base64UrlToUint8Array(base64Url: string): Uint8Array {
  const trimmed = base64Url.trim();
  const padding = "=".repeat((4 - (trimmed.length % 4)) % 4);
  const base64 = (trimmed + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  return Uint8Array.from([...raw].map((char) => char.charCodeAt(0)));
}

function browserSupportsPush(publicKey: string | undefined) {
  return Boolean(
    publicKey &&
      typeof navigator !== "undefined" &&
      "serviceWorker" in navigator &&
      "PushManager" in window &&
      "Notification" in window
  );
}

/** Bounds navigator.serviceWorker.ready, which otherwise never settles if no
 * worker ever activates — the classic "stuck on Enabling…" cause. */
async function readyRegistration(): Promise<ServiceWorkerRegistration> {
  await navigator.serviceWorker.register("/sw.js");
  return withTimeout(navigator.serviceWorker.ready, {
    operation: "service worker ready",
    timeoutMs: SERVICE_WORKER_READY_TIMEOUT_MS
  });
}

/**
 * Canonical browser Web Push state for both Settings and post-install
 * onboarding.
 *
 * The browser permission prompt is requested ONLY by enable(), and enable() is
 * invoked directly from a click handler (never wrapped in a React transition),
 * so `Notification.requestPermission()` runs while the transient user
 * activation the API requires is still valid — otherwise Safari/iOS throws
 * NotAllowedError and no prompt ever appears.
 */
export function useBrowserPush() {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const [status, setStatus] = useState<BrowserPushStatus>("checking");
  const [feedback, setFeedback] = useState("");
  const [isPending, setIsPending] = useState(false);
  const [lastFailure, setLastFailure] = useState<BrowserPushFailure | null>(null);

  const inspect = useCallback(async () => {
    if (!browserSupportsPush(publicKey)) {
      setStatus("unsupported");
      return;
    }

    try {
      const registration = await navigator.serviceWorker.getRegistration();
      const subscription = await registration?.pushManager.getSubscription();
      if (!subscription) {
        setStatus(Notification.permission === "denied" ? "denied" : "off");
        return;
      }

      // Re-persisting is idempotent and verifies that this authenticated
      // account owns the browser endpoint. A stale endpoint from another
      // account cannot be adopted because RLS + the unique endpoint reject the
      // write; remove the browser endpoint before continuing in that case.
      const result = await savePushSubscriptionAction(subscription.toJSON());
      if (!result.ok) {
        await subscription.unsubscribe();
        setStatus(Notification.permission === "denied" ? "denied" : "off");
        return;
      }
      setStatus("on");
    } catch {
      // A background status check must NEVER surface a loud error to the
      // onboarding prompt — the red error is reserved for a real, user-
      // initiated enable attempt (A2). Degrade to the recoverable "off" state.
      setStatus(Notification.permission === "denied" ? "denied" : "off");
    }
  }, [publicKey]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      void inspect();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [inspect]);

  const enable = useCallback(async (): Promise<EnablePushResult> => {
    if (!browserSupportsPush(publicKey)) {
      setStatus("unsupported");
      return { ok: false, permission: "unsupported", code: "unsupported" };
    }

    setFeedback("");
    setLastFailure(null);
    setIsPending(true);
    try {
      // Already blocked: do NOT call requestPermission again (it can't prompt),
      // route straight to the guidance state (A4).
      if (Notification.permission === "denied") {
        setStatus("denied");
        setLastFailure("permission_denied");
        return { ok: false, permission: "denied", code: "permission_denied" };
      }

      // (1) Permission — the FIRST async touch, so it runs inside the click's
      // transient activation. Safari throws instead of returning "denied".
      let permission: NotificationPermission;
      try {
        permission =
          Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
      } catch {
        setStatus("denied");
        setLastFailure("permission_denied");
        return { ok: false, permission: "denied", code: "permission_denied" };
      }

      if (permission === "denied") {
        setStatus("denied");
        setLastFailure("permission_denied");
        return { ok: false, permission, code: "permission_denied" };
      }
      if (permission !== "granted") {
        // "default": the user dismissed the prompt without choosing. Not an
        // error, and not retry-blocked — they can try again.
        setStatus("off");
        setLastFailure("permission_dismissed");
        return { ok: false, permission, code: "permission_dismissed" };
      }

      // (2) Service worker, bounded so a stuck worker can't hang the button.
      let registration: ServiceWorkerRegistration;
      try {
        registration = await readyRegistration();
      } catch (error) {
        const code: BrowserPushFailure = isRequestTimeoutError(error)
          ? "service_worker_timeout"
          : "service_worker_unavailable";
        setStatus("error");
        setLastFailure(code);
        setFeedback("We couldn't reach notifications on this device. Please try again.");
        return { ok: false, permission, code };
      }

      // (3) Subscribe (reuse an existing subscription; never duplicate).
      let subscription: PushSubscription;
      try {
        const existing = await registration.pushManager.getSubscription();
        subscription =
          existing ??
          (await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: base64UrlToUint8Array(publicKey as string).buffer as ArrayBuffer
          }));
      } catch {
        setStatus("error");
        setLastFailure("push_subscription_failed");
        setFeedback("Notifications couldn't be set up on this device. Please try again.");
        return { ok: false, permission, code: "push_subscription_failed" };
      }

      // (4) Persist against the authenticated account (owner-scoped, server-side).
      const result = await savePushSubscriptionAction(subscription.toJSON());
      if (!result.ok) {
        // The browser subscription exists but the DB write failed: do NOT claim
        // push is on. Undo the browser endpoint so a retry starts clean.
        try {
          await subscription.unsubscribe();
        } catch {
          /* best effort */
        }
        setStatus("error");
        setLastFailure("subscription_persist_failed");
        setFeedback("Notifications couldn't be connected to your account. Please try again.");
        return { ok: false, permission, code: "subscription_persist_failed", message: result.message };
      }

      setStatus("on");
      setFeedback(result.message);
      window.dispatchEvent(new Event("mad-buddy:push-subscription-changed"));
      return { ok: true, permission };
    } catch {
      setStatus("error");
      setLastFailure("unknown");
      setFeedback("Notifications could not be enabled. Please try again.");
      return { ok: false, permission: Notification.permission, code: "unknown" };
    } finally {
      // Guarantees the loading state always resets — no permanent spinner.
      setIsPending(false);
    }
  }, [publicKey]);

  const disable = useCallback(async () => {
    setFeedback("");
    setIsPending(true);
    try {
      const registration = await navigator.serviceWorker.getRegistration();
      const subscription = await registration?.pushManager.getSubscription();
      if (!subscription) {
        setStatus("off");
        return { ok: true };
      }

      const result = await deletePushSubscriptionAction(subscription.endpoint);
      await subscription.unsubscribe();
      setStatus("off");
      setFeedback(
        result.ok
          ? "Push notifications are off for this browser."
          : "Push is off in this browser, but account cleanup needs another try."
      );
      window.dispatchEvent(new Event("mad-buddy:push-subscription-changed"));
      return { ok: result.ok };
    } catch {
      setStatus("error");
      setFeedback("Push notifications could not be turned off. Try again.");
      return { ok: false };
    } finally {
      setIsPending(false);
    }
  }, []);

  const runEnable = useCallback(
    (onComplete?: (result: EnablePushResult) => void) => {
      // Called DIRECTLY from onClick — no startTransition — so the permission
      // request keeps the user's transient activation.
      void enable().then((result) => onComplete?.(result));
    },
    [enable]
  );

  const runDisable = useCallback(
    (onComplete?: (result: { ok: boolean }) => void) => {
      void disable().then((result) => onComplete?.(result));
    },
    [disable]
  );

  return {
    status,
    feedback,
    isPending,
    lastFailure,
    enable: runEnable,
    disable: runDisable,
    refresh: inspect
  };
}
