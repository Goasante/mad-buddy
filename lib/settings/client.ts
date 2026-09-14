import type { VisibilityStatus } from "@/lib/supabase/database.types";

/**
 * The transport seam for the shared Settings screen.
 *
 * Same reasoning as lib/notifications/client.ts: the screen renders and holds
 * state, and knows nothing about how bytes reach the server. Web sends
 * same-origin Server Actions with a session cookie; Android sends absolute
 * URLs with a Bearer token against the API origin. A component that called a
 * Server Action directly would drag `next/headers`, `lib/supabase/server` and
 * the service-role client into the mobile bundle -- the PR #84 failure.
 *
 * Both platforms end up in lib/settings/service.ts, so the validation and
 * merge semantics are one implementation rather than two that resemble
 * each other.
 *
 * Every method resolves rather than throwing: the screen reverts an optimistic
 * toggle and shows a message, and an exception crossing this boundary would
 * take a working screen down instead.
 */
export type SettingsWriteResult = {
  ok: boolean;
  /** Shown to the person when present; callers supply their own fallback. */
  message?: string;
};

export type SettingsClient = {
  /**
   * Ghost Mode and friends. The value is the canonical database enum, not a
   * boolean, because "visible" and "ghost" are not the only two states.
   */
  setVisibilityStatus(status: VisibilityStatus): Promise<SettingsWriteResult>;

  /**
   * Nearby alerts. Sends only this key: lib/settings/service.ts merges a
   * partial patch, so one switch cannot clobber the other preferences.
   */
  setNearbyAlerts(enabled: boolean): Promise<SettingsWriteResult>;
};
