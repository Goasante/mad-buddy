"use client";

import { BellRing } from "lucide-react";
import { useEffect, useState, useTransition } from "react";
import { deletePushSubscriptionAction, savePushSubscriptionAction } from "@/app/(app)/push-actions";
import { Button } from "@/components/ui/button";

function base64UrlToUint8Array(base64Url: string): Uint8Array {
  const padding = "=".repeat((4 - (base64Url.length % 4)) % 4);
  const base64 = (base64Url + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  return Uint8Array.from([...raw].map((char) => char.charCodeAt(0)));
}

/**
 * Browser push opt-in (batch 4 transport). The permission prompt fires only
 * from the explicit button tap, never on load. Hidden entirely when the
 * public VAPID key isn't configured or the browser can't do push.
 */
export function PushToggle() {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const [supported, setSupported] = useState(false);
  const [subscribed, setSubscribed] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (!publicKey || !("serviceWorker" in navigator) || !("PushManager" in window)) return;

    const frame = window.requestAnimationFrame(() => {
      setSupported(true);
      void navigator.serviceWorker.getRegistration().then(async (registration) => {
        const subscription = await registration?.pushManager.getSubscription();
        setSubscribed(Boolean(subscription));
      });
    });

    return () => window.cancelAnimationFrame(frame);
  }, [publicKey]);

  if (!supported) return null;

  function enable() {
    startTransition(async () => {
      try {
        const registration = await navigator.serviceWorker.register("/sw.js");
        const subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: base64UrlToUint8Array(publicKey as string).buffer as ArrayBuffer
        });
        const result = await savePushSubscriptionAction(subscription.toJSON());
        setFeedback(result.message);
        if (result.ok) setSubscribed(true);
      } catch {
        setFeedback("Push permission was refused or unavailable. In-app notifications still work.");
      }
    });
  }

  function disable() {
    startTransition(async () => {
      const registration = await navigator.serviceWorker.getRegistration();
      const subscription = await registration?.pushManager.getSubscription();
      if (subscription) {
        await deletePushSubscriptionAction(subscription.endpoint);
        await subscription.unsubscribe();
      }
      setSubscribed(false);
      setFeedback("Push notifications are off for this browser.");
    });
  }

  return (
    <div className="rounded-xl border border-border/70 bg-card/50 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="flex items-center gap-1.5 text-sm font-semibold">
            <BellRing className="h-4 w-4 text-primary" aria-hidden="true" />
            Browser push notifications
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Get pushes even when Mad Buddy isn&apos;t open. Your category settings, quiet hours, Focus Mode, and daily
            budget all still apply.
          </p>
        </div>
        {subscribed ? (
          <Button type="button" variant="outline" size="sm" disabled={isPending} onClick={disable}>
            Turn off
          </Button>
        ) : (
          <Button type="button" size="sm" disabled={isPending} onClick={enable}>
            Turn on
          </Button>
        )}
      </div>
      {feedback ? (
        <p className="mt-2 text-xs text-muted-foreground" role="status">
          {feedback}
        </p>
      ) : null}
    </div>
  );
}
