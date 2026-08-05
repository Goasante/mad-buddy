"use client";

import { createContext, useContext } from "react";

/**
 * Opens the app-wide menu sheet.
 *
 * The sheet itself is mounted ONCE in AppShell, which is also where its
 * identity data is resolved — so a screen that wants a Menu button in its
 * header does not have to mount its own sheet or receive identity props it
 * otherwise has no use for.
 *
 * Defaults to a no-op, so a header rendered outside the shell (a test, a
 * storybook-style harness) still works instead of throwing.
 */
const AppMenuContext = createContext<() => void>(() => {});

export function AppMenuProvider({
  openMenu,
  children
}: {
  openMenu: () => void;
  children: React.ReactNode;
}) {
  return <AppMenuContext.Provider value={openMenu}>{children}</AppMenuContext.Provider>;
}

/** The canonical "open the app menu" action for header Menu buttons. */
export function useAppMenu(): () => void {
  return useContext(AppMenuContext);
}
