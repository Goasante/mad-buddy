"use client";

import { useCallback, useTransition } from "react";
import { logoutAction } from "@/app/(auth)/actions";
import { announceSessionEnded } from "@/lib/auth/client-session";

export function useSecureLogout() {
  const [isPending, startTransition] = useTransition();

  const logout = useCallback(() => {
    startTransition(async () => {
      let pushEndpoint: string | null = null;
      try {
        const registration = await navigator.serviceWorker?.getRegistration();
        const subscription = await registration?.pushManager.getSubscription();
        pushEndpoint = subscription?.endpoint ?? null;
        // Removing the browser endpoint first guarantees privacy even if the
        // subsequent database cleanup experiences a transient failure.
        if (subscription) await subscription.unsubscribe();
      } catch {
        // Server-side owner-scoped deletion still runs when an endpoint was
        // available. Logout itself must never strand the user.
      }

      announceSessionEnded();
      await logoutAction({ pushEndpoint });
    });
  }, []);

  return { logout, isPending };
}
