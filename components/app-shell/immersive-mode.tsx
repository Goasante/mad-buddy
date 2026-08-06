"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

/**
 * Immersive mode: a screen temporarily takes the whole viewport and the global
 * bottom navigation steps aside.
 *
 * Conversation Mode is the first use. A conversation is not a page you browse
 * away from mid-sentence — the composer belongs at the bottom of the screen,
 * not stacked above a nav bar — so while one is open the bar hides and the
 * conversation reclaims that height.
 *
 * Deliberately a tiny shared flag rather than routing: whether a conversation
 * is open lives in the Messages page's own state (`selectedId`), not in the
 * URL, so the shell cannot derive it from the pathname. One context keeps a
 * single source of truth and avoids a second navigation system.
 *
 * The provider lives in AppShell, so the flag resets naturally on unmount and
 * no screen can leave the bar hidden behind it.
 */

type ImmersiveModeValue = {
  immersive: boolean;
  setImmersive: (active: boolean) => void;
};

const ImmersiveModeContext = createContext<ImmersiveModeValue | null>(null);

export function ImmersiveModeProvider({ children }: { children: React.ReactNode }) {
  const [immersive, setImmersiveState] = useState(false);

  const setImmersive = useCallback((active: boolean) => {
    setImmersiveState(active);
  }, []);

  const value = useMemo(() => ({ immersive, setImmersive }), [immersive, setImmersive]);

  return <ImmersiveModeContext.Provider value={value}>{children}</ImmersiveModeContext.Provider>;
}

/** Read the flag. Safe outside the provider (returns false) so no screen crashes. */
export function useImmersiveMode(): ImmersiveModeValue {
  return useContext(ImmersiveModeContext) ?? { immersive: false, setImmersive: () => {} };
}

/**
 * Declare that this screen is immersive while `active` is true.
 *
 * Clears itself on unmount, so navigating away — by tap, by Back, or by any
 * route change — always restores the bottom navigation. A screen cannot strand
 * the user without a nav bar by forgetting to turn it off.
 */
export function useImmersiveWhile(active: boolean): void {
  const { setImmersive } = useImmersiveMode();

  useEffect(() => {
    setImmersive(active);
    return () => setImmersive(false);
  }, [active, setImmersive]);
}
