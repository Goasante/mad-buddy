import { parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js/min";

/**
 * Phone numbers, normalised to E.164.
 *
 * WHY A LIBRARY AND NOT A REGEX: this decides who matches whom. Numbering plans
 * differ per country in trunk prefixes, national lengths, and which leading
 * digits are even assignable, and a hand-rolled normaliser gets those wrong in
 * ways that are invisible until two different people collide on one identifier.
 * That is not a formatting bug -- it shows a stranger's profile as somebody the
 * user knows.
 *
 * WHY THE `/min` ENTRY POINT: 82 KB of metadata against 154 KB for `/max`. The
 * difference is extended validation detail this feature does not use -- `/min`
 * still parses every country and formats E.164, which is the whole job. In
 * practice the size barely matters because normalisation runs server-side, but
 * the smallest correct option is still the right default.
 *
 * NOT marked server-only. The module is pure and has no secrets, and a client
 * may legitimately want to show "that doesn't look like a valid number" before
 * a round trip. The AUTHORITATIVE normalisation is always the server's -- a
 * client-supplied E.164 string is never trusted, it is re-normalised.
 */

/**
 * The default region for numbers typed without a country code.
 *
 * Ghana, because that is where most Mad Buddy users are today. This is a
 * DEFAULT, not a restriction: any number written in international form parses
 * correctly regardless of this value, and a caller with a better guess (the
 * user's own number, a locale) should pass one.
 */
export const DEFAULT_PHONE_REGION: CountryCode = "GH";

export type PhoneNormalisationResult =
  | { ok: true; e164: string; country: CountryCode | undefined }
  | { ok: false; reason: "empty" | "unparseable" | "invalid" | "too_long" };

/**
 * The longest input worth attempting.
 *
 * E.164 caps at 15 digits; this allows generous separators and punctuation on
 * top of that while refusing anything that could only be junk or an attempt to
 * make the parser work hard.
 */
const MAX_INPUT_LENGTH = 40;

/**
 * Normalises one number to E.164, or explains why it cannot be.
 *
 * Returns a REASON rather than throwing, because every caller here has to
 * handle failure anyway -- a user typing their own number, and a contact list
 * where some entries are landlines, short codes or saved wrong.
 */
export function normalisePhoneNumber(
  input: string | null | undefined,
  region: CountryCode = DEFAULT_PHONE_REGION
): PhoneNormalisationResult {
  const raw = (input ?? "").trim();
  if (!raw) return { ok: false, reason: "empty" };
  if (raw.length > MAX_INPUT_LENGTH) return { ok: false, reason: "too_long" };

  let parsed: ReturnType<typeof parsePhoneNumberFromString>;
  try {
    parsed = parsePhoneNumberFromString(raw, region);
  } catch {
    // The parser throws on some malformed inputs rather than returning
    // undefined. A contact list will contain those, so it cannot be fatal.
    return { ok: false, reason: "unparseable" };
  }

  if (!parsed) return { ok: false, reason: "unparseable" };

  // isValid() is stricter than isPossible(): it checks the number against the
  // country's actual assigned ranges, not merely its length. Worth the
  // strictness here, since a "possible but unassigned" number can never belong
  // to a real account and would only add noise to matching.
  if (!parsed.isValid()) return { ok: false, reason: "invalid" };

  return { ok: true, e164: parsed.number, country: parsed.country };
}

/**
 * Normalises many numbers at once, for contact matching.
 *
 * Silently DROPS anything that will not normalise. An address book routinely
 * holds short codes, service numbers and half-saved entries; failing the whole
 * batch because one contact is malformed would make the feature unusable.
 *
 * Deduplicates, because the same person is frequently saved twice (mobile and
 * WhatsApp, say) and there is no reason to match them twice.
 */
export function normalisePhoneNumbers(
  inputs: readonly (string | null | undefined)[],
  region: CountryCode = DEFAULT_PHONE_REGION
): string[] {
  const seen = new Set<string>();
  for (const input of inputs) {
    const result = normalisePhoneNumber(input, region);
    if (result.ok) seen.add(result.e164);
  }
  return [...seen];
}

/**
 * A display form for the OWNER of the number, and only them.
 *
 * Never shown to anyone else: a number is matching material, not profile
 * content. This exists so a person can confirm which of their numbers is on
 * the account without the raw string being treated as public.
 */
export function formatPhoneForOwner(e164: string): string {
  const parsed = parsePhoneNumberFromString(e164);
  return parsed?.formatInternational() ?? e164;
}

/**
 * The last few digits, for confirming identity without showing the number.
 *
 * Used in copy like "ending 4567" where the point is recognition rather than
 * disclosure.
 */
export function phoneHint(e164: string): string {
  const digits = e164.replace(/\D/g, "");
  return digits.length >= 4 ? digits.slice(-4) : "";
}
