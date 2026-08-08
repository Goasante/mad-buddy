import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";
import { registerPushNotifications, removeCurrentDeviceToken } from "../lib/push";

type AuthState = {
  loading: boolean;
  session: Session | null;
  user: User | null;
  /**
   * Canonical onboarding state, read from profiles.is_onboarded.
   *
   * `null` means "not resolved yet" and is deliberately distinct from `false`.
   * Routing on an unresolved value would bounce a fully onboarded user into
   * onboarding for one frame on every cold start, so guards must wait for
   * `loading` to clear rather than treating absence as incomplete.
   */
  isOnboarded: boolean | null;
  /** Re-reads onboarding state, for the screen that completes it. */
  refreshOnboarding: () => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  const [isOnboarded, setIsOnboarded] = useState<boolean | null>(null);

  useEffect(() => {
    let active = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      setLoading(false);
    });

    const {
      data: { subscription }
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  // Register this device for native push once a user is present (no-op on web).
  const userId = session?.user?.id ?? null;
  useEffect(() => {
    if (userId) void registerPushNotifications();
  }, [userId]);

  /**
   * Onboarding state comes from the PROFILE, never from the session.
   *
   * A session proves only that someone signed in; it says nothing about
   * whether they finished setting up. Routing on session alone let anyone
   * reopen the app and land on Home with an unfinished profile.
   */
  const loadOnboarding = useCallback(async (id: string | null) => {
    if (!id) {
      setIsOnboarded(null);
      return;
    }

    const { data, error } = await supabase
      .from("profiles")
      .select("is_onboarded")
      .eq("user_id", id)
      .maybeSingle();

    // FAIL CLOSED. A read error, or no profile row at all (an account whose
    // provisioning did not finish, including a fresh OAuth sign-in), both mean
    // "not known to be onboarded" -- so the user goes to onboarding, which is
    // recoverable. Assuming completion here would strand them on a Home screen
    // built from a profile that does not exist.
    setIsOnboarded(error ? false : Boolean(data?.is_onboarded));
  }, []);

  useEffect(() => {
    let active = true;
    void (async () => {
      if (!userId) {
        if (active) setIsOnboarded(null);
        return;
      }
      await loadOnboarding(userId);
    })();
    return () => {
      active = false;
    };
  }, [userId, loadOnboarding]);

  const value = useMemo<AuthState>(
    () => ({
      // Onboarding state is part of readiness: a guard that routes before it
      // resolves would flash the wrong screen on every cold start.
      loading: loading || (Boolean(userId) && isOnboarded === null),
      session,
      user: session?.user ?? null,
      isOnboarded,
      refreshOnboarding: () => loadOnboarding(userId),
      signOut: async () => {
        await removeCurrentDeviceToken();
        await supabase.auth.signOut();
      }
    }),
    [loading, session, userId, isOnboarded, loadOnboarding]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider");
  return context;
}
