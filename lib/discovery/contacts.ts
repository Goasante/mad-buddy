import { createHmac } from "crypto";

/**
 * Contact matching core (feature architecture batch 8, spec §39-§48).
 *
 * The privacy stance, encoded here rather than assumed:
 *  - A raw phone number or email is NEVER stored. Only a peppered HMAC of the
 *    normalized value ("protected identifier") is persisted, and only for users
 *    who explicitly opted in.
 *  - The pepper is a server secret, so the identifier space (which is small and
 *    fully enumerable for phone numbers) cannot be brute-forced from a database
 *    dump alone. A plain unsalted SHA-256 of a phone number is effectively
 *    reversible — spec §41 calls this out and this module refuses to do it.
 *  - Matching returns only accounts that matched. It never reveals which of the
 *    uploaded contacts are NOT on Mad Buddy (spec §41).
 */

// ---------------------------------------------------------------------------
// Normalization (spec §41, §47)
// ---------------------------------------------------------------------------

/**
 * Normalizes a phone number toward E.164. `defaultCountryCode` (e.g. "233" for
 * Ghana) is applied when the input is a local number, so "024 123 4567" and
 * "+233241234567" produce the same identifier (spec §47: international
 * formatting).
 */
export function normalizePhone(raw: string, defaultCountryCode: string): string | null {
  if (!raw) return null;
  // Keep digits and a single leading +.
  const trimmed = raw.trim();
  const hasPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length < 6 || digits.length > 15) return null;

  if (hasPlus) return `+${digits}`;

  // 00 international prefix.
  if (digits.startsWith("00")) {
    const rest = digits.slice(2);
    return rest.length >= 6 ? `+${rest}` : null;
  }

  // Local trunk form: drop a single leading 0 and prepend the country code.
  const country = defaultCountryCode.replace(/\D/g, "");
  if (!country) return null;
  const national = digits.startsWith("0") ? digits.slice(1) : digits;
  if (national.length < 6) return null;

  // Already includes the country code (e.g. "233241234567").
  if (digits.startsWith(country) && digits.length > country.length + 5) {
    return `+${digits}`;
  }
  return `+${country}${national}`;
}

/** Lowercase + trim. Deliberately does NOT strip gmail dots/plus-tags: those
 *  are provider-specific and guessing wrong would silently mis-match. */
export function normalizeEmail(raw: string): string | null {
  if (!raw) return null;
  const trimmed = raw.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return null;
  return trimmed;
}

// ---------------------------------------------------------------------------
// Protected identifiers (spec §41, §46)
// ---------------------------------------------------------------------------

/**
 * Produces the stored/queried identifier. Peppered HMAC — never a bare hash.
 * The same input always yields the same output for a given pepper, which is
 * what makes equality matching possible without ever holding the raw value.
 */
export function protectIdentifier(normalizedValue: string, pepper: string): string {
  if (!pepper) throw new Error("Contact matching requires a server pepper.");
  return createHmac("sha256", pepper).update(normalizedValue).digest("hex");
}

export const MAX_CONTACTS_PER_MATCH = 2000;

export type ContactMatchInput = {
  /** Already-normalized identifiers from the client. */
  identifiers: string[];
  pepper: string;
};

/**
 * Turns a batch of normalized identifiers into protected identifiers for
 * lookup. Caps the batch so a client can't dump an unbounded address book
 * (spec §47: device has thousands of contacts).
 */
export function protectIdentifierBatch(input: ContactMatchInput): string[] {
  const unique = [...new Set(input.identifiers.filter(Boolean))].slice(0, MAX_CONTACTS_PER_MATCH);
  return unique.map((value) => protectIdentifier(value, input.pepper));
}

// ---------------------------------------------------------------------------
// Bulk-invite guard (spec §44)
// ---------------------------------------------------------------------------

export const MAX_BULK_INVITES = 10;

/**
 * Non-users are never auto-invited (spec §44): the user picks who to invite,
 * and the count is bounded so contact matching can't become an SMS spam tool.
 */
export function validateBulkInviteCount(count: number): string | null {
  if (count < 1) return "Choose who to invite.";
  if (count > MAX_BULK_INVITES) return `You can invite up to ${MAX_BULK_INVITES} people at a time.`;
  return null;
}
