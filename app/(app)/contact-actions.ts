"use server";

import { revalidatePath } from "next/cache";

import {
  getPhoneIdentity,
  removePhoneNumber,
  savePhoneNumber,
  setContactDiscovery
} from "@/lib/contacts/phone-identity";
import { createRequestId, logBackendEvent } from "@/lib/observability/logger";
import {
  recordPermanentDismissal,
  recordPrivacyChange,
  recordReminderDismissal,
  recordSetupComplete
} from "@/lib/contacts/reminder-store";
import { consumeRateLimit, rateLimitMessage } from "@/lib/security/rate-limit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/supabase/auth";

/**
 * Phone identity and contact-discovery settings.
 *
 * Thin by design: every rule lives in lib/contacts, and these only resolve the
 * signed-in user and hand off. The user id ALWAYS comes from the session --
 * a client-supplied id would let one account write another's phone identity.
 *
 * No type is exported from this file. A "use server" module that exports a
 * type breaks every action in it at runtime under Turbopack, and tsc does not
 * catch it.
 */

type ContactActionState = { ok: boolean; message: string };

export async function savePhoneNumberAction(input: {
  phoneNumber: string;
  region?: string;
}): Promise<ContactActionState> {
  const requestId = createRequestId();
  const user = await getCurrentUser();
  if (!user) return { ok: false, message: "Log in to add your number." };

  // Bounded before any parsing work: a phone field has no legitimate reason
  // to carry more than this.
  if (typeof input?.phoneNumber !== "string" || input.phoneNumber.length > 40) {
    return { ok: false, message: "That doesn't look like a valid phone number." };
  }

  const limit = await consumeRateLimit({ action: "contacts.phone_update", userId: user.id, requestId });
  if (!limit.allowed) return { ok: false, message: rateLimitMessage(limit.resetAt) };

  const admin = createSupabaseAdminClient();
  const result = await savePhoneNumber(admin, {
    userId: user.id,
    input: input.phoneNumber,
    // Only a two-letter region is accepted; anything else falls back to the
    // service default rather than reaching the parser.
    region: /^[A-Z]{2}$/.test(input.region ?? "") ? (input.region as never) : undefined,
    requestId
  });

  if (!result.ok) return { ok: false, message: result.message };

  revalidatePath("/settings/contact-discovery");
  // Deliberately "added", never "verified": nothing here proves the number
  // belongs to this person, and saying otherwise would be a false claim.
  return { ok: true, message: "Phone number added." };
}

export async function removePhoneNumberAction(): Promise<ContactActionState> {
  const requestId = createRequestId();
  const user = await getCurrentUser();
  if (!user) return { ok: false, message: "Log in to change your number." };

  const admin = createSupabaseAdminClient();
  const result = await removePhoneNumber(admin, { userId: user.id, requestId });

  if (result.ok) {
    // A deliberate privacy change, not a declined prompt. Reminders go quiet
    // rather than asking them to undo it next week.
    await recordPrivacyChange(admin, user.id);
  }

  revalidatePath("/settings/contact-discovery");
  return result;
}

export async function setContactDiscoveryAction(enabled: boolean): Promise<ContactActionState> {
  const requestId = createRequestId();
  const user = await getCurrentUser();
  if (!user) return { ok: false, message: "Log in to change this setting." };

  const admin = createSupabaseAdminClient();
  const result = await setContactDiscovery(admin, { userId: user.id, enabled, requestId });

  if (result.ok && !enabled) {
    // Switching discovery OFF is a choice. Only the OFF direction suppresses:
    // turning it on needs no quiet period.
    await recordPrivacyChange(admin, user.id);
  }

  revalidatePath("/settings/contact-discovery");
  return result;
}

/**
 * The signed-in user's own phone identity, for rendering the settings screen.
 *
 * Returns a HINT ("4567"), never the number. The owner already knows their own
 * number; what they need is enough to recognise which one is on the account,
 * and a full number on screen is a full number in a screenshot.
 */
export async function getPhoneIdentityAction(): Promise<{
  hasPhone: boolean;
  hint: string;
  discoveryEnabled: boolean;
}> {
  const user = await getCurrentUser();
  if (!user) return { hasPhone: false, hint: "", discoveryEnabled: false };

  const admin = createSupabaseAdminClient();
  const identity = await getPhoneIdentity(admin, user.id);

  return {
    hasPhone: Boolean(identity),
    hint: identity?.hint ?? "",
    discoveryEnabled: identity?.discoveryEnabled ?? false
    // verifiedAt is deliberately NOT surfaced. It is always null, and sending
    // it invites a client to render a verification state that does not exist.
  };
}

/**
 * "Maybe later".
 *
 * Increments the dismissal count and sets the next eligible time. It does NOT
 * disable anything -- Find Your Muddies stays reachable from Muddies and
 * Settings, and no contact permission is involved at any point.
 */
export async function dismissContactReminderAction(): Promise<ContactActionState> {
  const requestId = createRequestId();
  const user = await getCurrentUser();
  if (!user) return { ok: false, message: "" };

  const admin = createSupabaseAdminClient();
  const next = await recordReminderDismissal(admin, user.id);

  // High-level only: which prompt was declined and how many times. No contact
  // data of any kind is involved in a reminder.
  logBackendEvent("info", {
    requestId,
    action: "contact_reminder_maybe_later",
    statusCode: 200,
    userId: user.id
  });

  return { ok: true, message: next.dismissCount >= 3 ? "We won't ask again." : "" };
}

/**
 * "Don't ask again".
 *
 * Suppresses AUTOMATIC reminders permanently. Discovery stays as it is, the
 * number stays, friendships are untouched, and the feature stays reachable by
 * hand.
 */
export async function stopContactRemindersAction(): Promise<ContactActionState> {
  const requestId = createRequestId();
  const user = await getCurrentUser();
  if (!user) return { ok: false, message: "" };

  const admin = createSupabaseAdminClient();
  await recordPermanentDismissal(admin, user.id);

  logBackendEvent("info", {
    requestId,
    action: "contact_reminder_permanently_dismissed",
    statusCode: 200,
    userId: user.id
  });

  return { ok: true, message: "We won't ask about this again. You can still find Muddies from Settings." };
}

/**
 * Records that setup was deliberately completed.
 *
 * Called when somebody finishes Find Your Muddies -- never when they merely
 * save a number, since adding a number and connecting contacts are different
 * steps and the second prompt exists for the gap between them.
 */
export async function completeContactSetupAction(): Promise<ContactActionState> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, message: "" };

  const admin = createSupabaseAdminClient();
  await recordSetupComplete(admin, user.id);
  return { ok: true, message: "" };
}
