import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { CountryCode } from "libphonenumber-js/min";

import { DEFAULT_PHONE_REGION, normalisePhoneNumber, phoneHint } from "@/lib/contacts/phone-normalization";
import { logBackendEvent } from "@/lib/observability/logger";
import {
  ACTIVE_KEY_VERSION,
  deriveMatchIdentifier,
  matchingConfigured
} from "@/lib/contacts/match-identifier";

/**
 * Adding, changing and removing the phone number on an account.
 *
 * The number exists for ONE reason today: letting people who already have it
 * saved find this account. It is not a login, not a recovery factor, and not
 * profile content. Nothing here presents it to another user.
 *
 * NOTHING IS TRUSTED FROM THE CLIENT. The submitted string is re-normalised
 * server-side, and the E.164 form the client believes it sent is ignored --
 * otherwise a caller could send a string that normalises one way for matching
 * and displays another.
 */

export type PhoneIdentity = {
  phoneE164: string;
  /** Last four digits, for owner-facing confirmation copy. Never the number. */
  hint: string;
  discoveryEnabled: boolean;
  /** Always null until real verification exists. */
  verifiedAt: string | null;
};

export type SavePhoneResult =
  | { ok: true; identity: PhoneIdentity }
  | { ok: false; reason: "invalid" | "claimed" | "failed"; message: string };

/**
 * Copy for a normalisation failure.
 *
 * Deliberately vague about WHY beyond "check it": the parser can distinguish
 * "unassigned range" from "wrong length", but surfacing that turns the form
 * into an oracle for which numbers exist in a country's plan.
 */
const INVALID_MESSAGE = "That doesn't look like a valid phone number. Check it and try again.";

/**
 * Saves a number against an account.
 *
 * DUPLICATE HANDLING, and why it fails rather than transfers:
 *
 * No number here is verified, so a claim is only a claim. If account B submits
 * a number account A is already using for discovery, silently moving it would
 * let anyone steal another person's contact matches by typing their number --
 * every contact who has A saved would start seeing B. So the second claim is
 * REJECTED, and the first keeps it.
 *
 * The database enforces this too, with a partial unique index on
 * (phone_e164) where contact_discovery_enabled. The check below produces a
 * decent message; the index is what makes the guarantee real under a race,
 * where two requests can both pass the check before either writes.
 *
 * A dormant claim -- a number saved with discovery OFF -- constrains nobody,
 * so a genuine number change is not blocked by an account that is not using it.
 */
export async function savePhoneNumber(
  admin: SupabaseClient,
  {
    userId,
    input,
    region = DEFAULT_PHONE_REGION,
    requestId
  }: { userId: string; input: string; region?: CountryCode; requestId: string }
): Promise<SavePhoneResult> {
  const normalised = normalisePhoneNumber(input, region);

  if (!normalised.ok) {
    // The REASON is logged, never the number itself.
    logBackendEvent("info", {
      requestId,
      action: "contacts.phone_save",
      statusCode: 400,
      userId,
      errorType: `phone_${normalised.reason}`
    });
    return { ok: false, reason: "invalid", message: INVALID_MESSAGE };
  }

  const { e164, country } = normalised;

  // Best-effort: an unconfigured secret must not stop someone saving their
  // number. It only means discovery cannot match them yet, which the endpoint
  // reports honestly rather than returning a silently empty result.
  const matchIdentifier = matchingConfigured() ? deriveMatchIdentifier(e164) : null;

  // Is another ACTIVE account already discoverable on this number?
  const { data: existing } = await admin
    .from("user_phone_identities")
    .select("user_id")
    .eq("phone_e164", e164)
    .eq("contact_discovery_enabled", true)
    .maybeSingle();

  if (existing && existing.user_id !== userId) {
    logBackendEvent("warn", {
      requestId,
      action: "contacts.phone_save",
      statusCode: 409,
      userId,
      errorType: "phone_already_claimed"
    });
    return {
      ok: false,
      reason: "claimed",
      // Says what happened without confirming whose account holds it -- which
      // would turn this into a way to check whether a number is registered.
      message:
        "That number is already in use for contact discovery on another account. If it's yours, remove it there first."
    };
  }

  const { data, error } = await admin
    .from("user_phone_identities")
    .upsert(
      {
        user_id: userId,
        phone_e164: e164,
        phone_region: country ?? null,
        // Derived here, at write time, so matching never has to touch a raw
        // number. Absent when matching is unconfigured -- the row still saves,
        // it simply cannot produce a match until an identifier exists.
        match_hmac: matchIdentifier?.identifier ?? null,
        match_key_version: matchIdentifier?.keyVersion ?? ACTIVE_KEY_VERSION,
        updated_at: new Date().toISOString()
        // phone_verified_at deliberately absent. It stays NULL, and the
        // database trigger rejects any attempt to set it outside the service
        // role -- there is no verification to record yet.
        // contact_discovery_enabled deliberately absent too: adding a number
        // must never turn discovery on as a side effect.
      },
      { onConflict: "user_id" }
    )
    .select("phone_e164, contact_discovery_enabled, phone_verified_at")
    .maybeSingle();

  if (error || !data) {
    logBackendEvent("error", {
      requestId,
      action: "contacts.phone_save",
      statusCode: 500,
      userId,
      errorType: "phone_write_failed"
    });
    return { ok: false, reason: "failed", message: "Your number could not be saved. Please try again." };
  }

  logBackendEvent("info", { requestId, action: "contacts.phone_save", statusCode: 200, userId });

  return {
    ok: true,
    identity: {
      phoneE164: data.phone_e164,
      hint: phoneHint(data.phone_e164),
      discoveryEnabled: data.contact_discovery_enabled,
      verifiedAt: data.phone_verified_at
    }
  };
}

/**
 * Removes the number entirely.
 *
 * A hard delete, not a flag. "Remove my number" has to mean the row is gone --
 * a soft-deleted row would keep producing matches for anyone whose query
 * forgot the filter, which is the failure mode this whole feature must not
 * have.
 */
export async function removePhoneNumber(
  admin: SupabaseClient,
  { userId, requestId }: { userId: string; requestId: string }
): Promise<{ ok: boolean; message: string }> {
  const { error } = await admin.from("user_phone_identities").delete().eq("user_id", userId);

  if (error) {
    logBackendEvent("error", {
      requestId,
      action: "contacts.phone_remove",
      statusCode: 500,
      userId,
      errorType: "phone_delete_failed"
    });
    return { ok: false, message: "Your number could not be removed. Please try again." };
  }

  logBackendEvent("info", { requestId, action: "contacts.phone_remove", statusCode: 200, userId });
  return { ok: true, message: "Your number was removed. People with it saved can no longer find you here." };
}

/**
 * Turns contact discovery on or off.
 *
 * Separate from saving the number, deliberately. Storing a number and being
 * findable by it are two different consents, and collapsing them into one
 * action would make the first imply the second.
 *
 * Turning it ON requires a number to already exist: there is nothing to be
 * discoverable by otherwise, and a flag set against no number would quietly
 * become active the moment one was added.
 */
export async function setContactDiscovery(
  admin: SupabaseClient,
  { userId, enabled, requestId }: { userId: string; enabled: boolean; requestId: string }
): Promise<{ ok: boolean; message: string }> {
  const { data: identity } = await admin
    .from("user_phone_identities")
    .select("phone_e164")
    .eq("user_id", userId)
    .maybeSingle();

  if (!identity) {
    return { ok: false, message: "Add your phone number first." };
  }

  if (enabled) {
    // Re-checked at enable time, not only at save time. A number saved while
    // dormant can be claimed by someone else in the meantime, and the partial
    // unique index covers exactly this row becoming active.
    const { data: clash } = await admin
      .from("user_phone_identities")
      .select("user_id")
      .eq("phone_e164", identity.phone_e164)
      .eq("contact_discovery_enabled", true)
      .maybeSingle();

    if (clash && clash.user_id !== userId) {
      return {
        ok: false,
        message: "That number is already in use for contact discovery on another account."
      };
    }
  }

  const { error } = await admin
    .from("user_phone_identities")
    .update({ contact_discovery_enabled: enabled, updated_at: new Date().toISOString() })
    .eq("user_id", userId);

  if (error) {
    logBackendEvent("error", {
      requestId,
      action: "contacts.discovery_toggle",
      statusCode: 500,
      userId,
      errorType: "discovery_write_failed"
    });
    return { ok: false, message: "That setting could not be saved. Please try again." };
  }

  logBackendEvent("info", {
    requestId,
    action: "contacts.discovery_toggle",
    statusCode: 200,
    userId
  });

  return {
    ok: true,
    message: enabled
      ? "People who have your number saved can now find you on Mad Buddy."
      : "You're no longer findable by phone number."
  };
}

/** The owner's own phone identity, or null. Never called for another user. */
export async function getPhoneIdentity(
  admin: SupabaseClient,
  userId: string
): Promise<PhoneIdentity | null> {
  const { data } = await admin
    .from("user_phone_identities")
    .select("phone_e164, contact_discovery_enabled, phone_verified_at")
    .eq("user_id", userId)
    .maybeSingle();

  if (!data) return null;

  return {
    phoneE164: data.phone_e164,
    hint: phoneHint(data.phone_e164),
    discoveryEnabled: data.contact_discovery_enabled,
    verifiedAt: data.phone_verified_at
  };
}
