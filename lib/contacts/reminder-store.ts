import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  EMPTY_REMINDER_STATE,
  afterDismissal,
  afterPermanentDismissal,
  afterPrivacyChange,
  afterSetupComplete,
  type ContactReminderState
} from "@/lib/contacts/reminder-eligibility";

/**
 * Where reminder state lives.
 *
 * NO MIGRATION. `user_preferences.communication_preferences` is an existing
 * JSONB column on a table every account already has, and reminder state is
 * exactly what it is for: a small per-account preference with no schema of its
 * own worth defending.
 *
 * WHY NOT app_preferences: that column carries a strictly-validated locale
 * object, and its settings action replaces the whole value. Storing reminder
 * state there would mean a language change silently wiping somebody's
 * cooldown.
 *
 * ACCOUNT LEVEL, NOT localStorage. Dismissing on a phone must not produce a
 * prompt on a laptop ten seconds later. The server is canonical; a client may
 * cache what it reads, but only this decides.
 *
 * DELETION IS ALREADY HANDLED: `user_preferences` is in DELETION_TABLES, so
 * reminder state is purged with the account and no orphan row survives.
 */

/** The key inside communication_preferences. Namespaced, so it cannot collide. */
const REMINDER_KEY = "contactDiscoveryReminder";

type CommunicationPreferences = Record<string, unknown> & {
  [REMINDER_KEY]?: Partial<ContactReminderState>;
};

/**
 * Reads the state, defaulting to "never prompted".
 *
 * Fails OPEN into the empty state rather than throwing: a preferences read
 * failing should mean the prompt behaves as it would for a new account, never
 * that the surface it lives on breaks.
 */
export async function loadReminderState(
  admin: SupabaseClient,
  userId: string
): Promise<ContactReminderState> {
  const { data } = await admin
    .from("user_preferences")
    .select("communication_preferences")
    .eq("user_id", userId)
    .maybeSingle();

  const stored = (data?.communication_preferences as CommunicationPreferences | null)?.[REMINDER_KEY];
  if (!stored) return EMPTY_REMINDER_STATE;

  // Field by field, so a partial or malformed value cannot produce a state
  // object with holes in it.
  return {
    lastPromptedAt: typeof stored.lastPromptedAt === "string" ? stored.lastPromptedAt : null,
    dismissCount: typeof stored.dismissCount === "number" ? stored.dismissCount : 0,
    suppressedUntil: typeof stored.suppressedUntil === "string" ? stored.suppressedUntil : null,
    permanentlyDismissed: stored.permanentlyDismissed === true,
    setupCompletedAt: typeof stored.setupCompletedAt === "string" ? stored.setupCompletedAt : null
  };
}

/**
 * Writes the state back, preserving everything else in the column.
 *
 * Read-modify-write on the JSON rather than replacing it: this column also
 * holds messaging preferences, and clobbering those to record a dismissal
 * would be a bad trade.
 */
async function saveReminderState(
  admin: SupabaseClient,
  userId: string,
  next: ContactReminderState
): Promise<boolean> {
  const { data } = await admin
    .from("user_preferences")
    .select("communication_preferences")
    .eq("user_id", userId)
    .maybeSingle();

  const existing = (data?.communication_preferences as CommunicationPreferences | null) ?? {};

  const { error } = await admin.from("user_preferences").upsert(
    {
      user_id: userId,
      communication_preferences: { ...existing, [REMINDER_KEY]: next },
      updated_at: new Date().toISOString()
    },
    { onConflict: "user_id" }
  );

  return !error;
}

/** Records a "Maybe later" and the cooldown it earns. */
export async function recordReminderDismissal(
  admin: SupabaseClient,
  userId: string
): Promise<ContactReminderState> {
  const next = afterDismissal(await loadReminderState(admin, userId));
  await saveReminderState(admin, userId, next);
  return next;
}

/** Records "Don't ask again". Reminder preference only; the feature stays. */
export async function recordPermanentDismissal(
  admin: SupabaseClient,
  userId: string
): Promise<ContactReminderState> {
  const next = afterPermanentDismissal(await loadReminderState(admin, userId));
  await saveReminderState(admin, userId, next);
  return next;
}

/**
 * Records that setup was deliberately finished.
 *
 * Called when somebody completes Find Your Muddies, NOT when they merely save
 * a number -- adding a number and connecting contacts are different steps, and
 * conflating them would silence the prompt that exists for the gap between.
 */
export async function recordSetupComplete(
  admin: SupabaseClient,
  userId: string
): Promise<ContactReminderState> {
  const next = afterSetupComplete(await loadReminderState(admin, userId));
  await saveReminderState(admin, userId, next);
  return next;
}

/**
 * Records a deliberate privacy change and goes quiet.
 *
 * Removing a number or turning discovery off is a decision. This does not
 * count as a dismissal -- declining a prompt and changing a setting are
 * different acts, and treating them alike would burn a dismissal somebody
 * never made.
 */
export async function recordPrivacyChange(
  admin: SupabaseClient,
  userId: string
): Promise<ContactReminderState> {
  const next = afterPrivacyChange(await loadReminderState(admin, userId));
  await saveReminderState(admin, userId, next);
  return next;
}
