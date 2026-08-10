"use server";

import { revalidatePath } from "next/cache";

import {
  getPhoneIdentity,
  removePhoneNumber,
  savePhoneNumber,
  setContactDiscovery
} from "@/lib/contacts/phone-identity";
import { createRequestId } from "@/lib/observability/logger";
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

  revalidatePath("/settings/contact-discovery");
  return result;
}

export async function setContactDiscoveryAction(enabled: boolean): Promise<ContactActionState> {
  const requestId = createRequestId();
  const user = await getCurrentUser();
  if (!user) return { ok: false, message: "Log in to change this setting." };

  const admin = createSupabaseAdminClient();
  const result = await setContactDiscovery(admin, { userId: user.id, enabled, requestId });

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
