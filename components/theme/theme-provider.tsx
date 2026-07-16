"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode
} from "react";

export type ResolvedTheme = "light" | "dark";
export type ThemePreference = "light" | "dark" | "system";
export type AccentColor = "orange" | "blue" | "violet" | "green" | "red" | "teal";

const THEME_PREFERENCE_KEY = "mad-buddy-theme-preference";
const ACCENT_COLOR_KEY = "mad-buddy-accent-color";

type ThemeContextValue = {
  theme: ResolvedTheme;
  preference: ThemePreference;
  setPreference: (preference: ThemePreference) => void;
  accentColor: AccentColor;
  setAccentColor: (color: AccentColor) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

function systemPrefersDark(): boolean {
  if (typeof window === "undefined") return true;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function readStoredPreference(): ThemePreference {
  if (typeof window === "undefined") return "system";
  const stored = window.localStorage.getItem(THEME_PREFERENCE_KEY);
  return stored === "light" || stored === "dark" || stored === "system" ? stored : "system";
}

function readStoredAccent(): AccentColor {
  if (typeof window === "undefined") return "orange";
  const stored = window.localStorage.getItem(ACCENT_COLOR_KEY);
  const valid: AccentColor[] = ["orange", "blue", "violet", "green", "red", "teal"];
  return valid.includes(stored as AccentColor) ? (stored as AccentColor) : "orange";
}

function applyTheme(theme: ResolvedTheme) {
  document.documentElement.classList.toggle("dark", theme === "dark");
  document.documentElement.style.colorScheme = theme;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const systemPrefersDarkNow = useSyncExternalStore<boolean>(
    (onStoreChange) => {
      const media = window.matchMedia("(prefers-color-scheme: dark)");
      media.addEventListener("change", onStoreChange);
      return () => media.removeEventListener("change", onStoreChange);
    },
    systemPrefersDark,
    () => true
  );

  const [preference, setPreferenceState] = useState<ThemePreference>(readStoredPreference);
  const [accentColor, setAccentColorState] = useState<AccentColor>(readStoredAccent);

  const theme: ResolvedTheme = preference === "system" ? (systemPrefersDarkNow ? "dark" : "light") : preference;

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    document.documentElement.setAttribute("data-accent", accentColor);
  }, [accentColor]);

  function setPreference(next: ThemePreference) {
    setPreferenceState(next);
    window.localStorage.setItem(THEME_PREFERENCE_KEY, next);
  }

  function setAccentColor(next: AccentColor) {
    setAccentColorState(next);
    window.localStorage.setItem(ACCENT_COLOR_KEY, next);
  }

  const value = useMemo(
    () => ({ theme, preference, setPreference, accentColor, setAccentColor }),
    [theme, preference, accentColor]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeContext);

  if (!context) {
    throw new Error("useTheme must be used inside ThemeProvider.");
  }

  return context;
}
