import type { Json } from "@/lib/supabase/database.types";

export const LANGUAGE_OPTIONS = ["English (US)", "English (UK)", "Twi", "French"] as const;
export const REGION_OPTIONS = ["Ghana (GH)", "Nigeria (NG)", "United States (US)", "United Kingdom (UK)"] as const;
export const TIME_ZONE_OPTIONS = ["Africa/Accra", "Africa/Lagos", "America/New_York", "Europe/London"] as const;
export const DATE_FORMAT_OPTIONS = ["DD MMM YYYY", "MM/DD/YYYY", "DD/MM/YYYY"] as const;

export type AppPreferences = {
  language: (typeof LANGUAGE_OPTIONS)[number];
  region: (typeof REGION_OPTIONS)[number];
  timeZone: (typeof TIME_ZONE_OPTIONS)[number];
  dateFormat: (typeof DATE_FORMAT_OPTIONS)[number];
  timeFormat: "12h" | "24h";
};

export const DEFAULT_APP_PREFERENCES: AppPreferences = {
  language: "English (UK)",
  region: "Ghana (GH)",
  timeZone: "Africa/Accra",
  dateFormat: "DD MMM YYYY",
  timeFormat: "24h"
};

function includes<T extends readonly string[]>(options: T, value: unknown): value is T[number] {
  return typeof value === "string" && options.includes(value);
}

export function normalizeAppPreferences(value: Json | null | undefined): AppPreferences {
  if (!value || typeof value !== "object" || Array.isArray(value)) return DEFAULT_APP_PREFERENCES;
  return {
    language: includes(LANGUAGE_OPTIONS, value.language) ? value.language : DEFAULT_APP_PREFERENCES.language,
    region: includes(REGION_OPTIONS, value.region) ? value.region : DEFAULT_APP_PREFERENCES.region,
    timeZone: includes(TIME_ZONE_OPTIONS, value.timeZone) ? value.timeZone : DEFAULT_APP_PREFERENCES.timeZone,
    dateFormat: includes(DATE_FORMAT_OPTIONS, value.dateFormat) ? value.dateFormat : DEFAULT_APP_PREFERENCES.dateFormat,
    timeFormat: value.timeFormat === "12h" || value.timeFormat === "24h" ? value.timeFormat : DEFAULT_APP_PREFERENCES.timeFormat
  };
}
