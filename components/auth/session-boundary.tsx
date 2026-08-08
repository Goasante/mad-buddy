"use client";

import { useEffect } from "react";
import { clearUserScopedBrowserState, subscribeToSessionEnd } from "@/lib/auth/client-session";
import { POST_LOGIN_ROUTE } from "@/lib/routes";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export function SessionBoundary({ currentUserId }: { currentUserId?: string | null }) {
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
  return null;
}
