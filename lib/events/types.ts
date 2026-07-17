/**
 * Plain shared types for the events feature (batch 5). Kept free of
 * "server-only" so client components can import the response shapes returned
 * by the event server actions.
 */

export type { CheckInVisibility } from "@/lib/supabase/database.types";

export type EventGlowMuddySummary = {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  status: string | null;
};

/** Response shape of the Event Glow list (spec §39). Never carries location. */
export type EventGlowMuddyList = {
  count: number;
  muddies: EventGlowMuddySummary[];
};
