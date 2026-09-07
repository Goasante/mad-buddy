"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { clearUserScopedBrowserState, subscribeToSessionEnd } from "@/lib/auth/client-session";
import { POST_LOGIN_ROUTE } from "@/lib/routes";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export function SessionBoundary({ currentUserId }: { currentUserId?: string | null }) {
  const router = useRouter();
  const latestSupportRepairVersion = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    const unsubscribeSessionEnd = subscribeToSessionEnd(() => {
      clearUserScopedBrowserState();
      window.location.replace("/");
    });

    let authSubscription: { unsubscribe: () => void } | null = null;
    try {
      const supabase = createSupabaseBrowserClient();
      const { data } = supabase.auth.onAuthStateChange((event, session) => {
        if (event === "SIGNED_OUT") {
          clearUserScopedBrowserState();
          window.location.replace("/login");
          return;
        }
        if (event === "SIGNED_IN" && currentUserId && session?.user.id !== currentUserId) {
          clearUserScopedBrowserState();
          window.location.replace(POST_LOGIN_ROUTE);
        }
      });
      authSubscription = data.subscription;
    } catch {
      // Server-side route protection remains authoritative when the browser
      // auth client is unavailable.
    }

    return () => {
      unsubscribeSessionEnd();
      authSubscription?.unsubscribe();
    };
  }, [currentUserId]);

  useEffect(() => {
    if (!currentUserId) return;

    let cancelled = false;
    let inFlight = false;

    async function checkForSupportRepair() {
      if (cancelled || inFlight || document.visibilityState === "hidden") return;
      inFlight = true;
      try {
        const response = await fetch("/api/account/support-refresh", {
          method: "GET",
          cache: "no-store",
          credentials: "same-origin",
          headers: { Accept: "application/json" }
        });
        if (!response.ok) return;
        const body = (await response.json()) as { version?: string | null };
        const nextVersion = typeof body.version === "string" ? body.version : null;
        const previousVersion = latestSupportRepairVersion.current;
        latestSupportRepairVersion.current = nextVersion;

        // The first successful check establishes a baseline. If Support ran a
        // repair before this page loaded, this server render is already fresh,
        // so forcing another render would only create a loop. A later change is
        // the signal that an already-open app should refresh canonical state.
        if (previousVersion !== undefined && nextVersion && nextVersion !== previousVersion) {
          router.refresh();
          window.dispatchEvent(new CustomEvent("madbuddy:account-repaired"));
        }
      } catch {
        // Best-effort only. A support refresh signal must never interrupt the
        // user's app when the network or observability path is unavailable.
      } finally {
        inFlight = false;
      }
    }

    void checkForSupportRepair();

    const onFocus = () => void checkForSupportRepair();
    const onVisibility = () => {
      if (document.visibilityState === "visible") void checkForSupportRepair();
    };
    const onPageShow = () => void checkForSupportRepair();
    const interval = window.setInterval(() => void checkForSupportRepair(), 60_000);

    window.addEventListener("focus", onFocus);
    window.addEventListener("pageshow", onPageShow);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("pageshow", onPageShow);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [currentUserId, router]);

  return null;
}
