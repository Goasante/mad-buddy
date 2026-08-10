import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Matching identifiers for contact discovery.
 *
 * WHY NOT A PLAIN SHA-256 OF THE NUMBER:
 *
 *   The search space is tiny. Ghana mobile numbers are effectively nine digits
 *   after the country code, so an unsalted hash of every possible number is a
 *   few hundred million rows -- minutes of work on a laptop. Anyone who
 *   obtained the hash column could reverse the entire table back to phone
 *   numbers. "Hashed" is not "private" when the input is guessable.
 *
 *   An HMAC keyed with a server-only secret removes that: without the key the
 *   attacker cannot compute a candidate hash at all, so an exfiltrated column
 *   is inert.
 *
 * THE SECRET NEVER LEAVES THE SERVER. This module is server-only, the key is
 * read from the environment, and no derived value is returned to a client. A
 * caller receives matched PROFILES, never identifiers.
 *
 * KEY VERSIONING: every stored identifier records which key produced it. A
 * compromised or rotated key therefore does not invalidate matching -- new
 * writes use the current key, old rows keep working until they are recomputed,
 * and the two can coexist. Without a version column, rotation would mean
 * silently breaking every existing match with no way to tell which rows were
 * stale.
 */

/**
 * The active key version.
 *
 * Bumped when the secret is rotated. Identifiers written from that point carry
 * the new version, and `activeKeyVersion` is what a recompute job would target.
 */
export const ACTIVE_KEY_VERSION = 1;

/** The environment variable holding each version's secret. */
function secretEnvName(version: number): string {
  return version === 1 ? "CONTACT_MATCH_HMAC_SECRET" : `CONTACT_MATCH_HMAC_SECRET_V${version}`;
}

export class MissingMatchSecretError extends Error {
  constructor(version: number) {
    // Names the variable, never its value.
    super(`Contact matching is not configured: ${secretEnvName(version)} is unset.`);
    this.name = "MissingMatchSecretError";
  }
}

/**
 * Reads a version's secret.
 *
 * THROWS rather than falling back to a default. A hard-coded or empty fallback
 * would produce identifiers anyone could recompute, which is precisely the
 * property this module exists to prevent -- and it would fail silently, with
 * matching appearing to work.
 */
function matchSecret(version: number = ACTIVE_KEY_VERSION): string {
  const secret = process.env[secretEnvName(version)];
  if (!secret || secret.length < 32) {
    // Also rejects a too-short key: a 6-character secret is brute-forceable
    // and would give false confidence.
    throw new MissingMatchSecretError(version);
  }
  return secret;
}

/** True when matching is configured, for callers that must degrade gracefully. */
export function matchingConfigured(version: number = ACTIVE_KEY_VERSION): boolean {
  const secret = process.env[secretEnvName(version)];
  return Boolean(secret && secret.length >= 32);
}

export type MatchIdentifier = {
  /** Hex HMAC of the E.164 number. Never derived from anything else. */
  identifier: string;
  keyVersion: number;
};

/**
 * Derives the matching identifier for one E.164 number.
 *
 * The input MUST already be normalised. Two spellings of the same number
 * produce two different HMACs, so normalisation is what makes matching work at
 * all -- and it is why the server re-normalises rather than trusting a client's
 * E.164 string.
 */
export function deriveMatchIdentifier(
  e164: string,
  version: number = ACTIVE_KEY_VERSION
): MatchIdentifier {
  return {
    identifier: createHmac("sha256", matchSecret(version)).update(e164).digest("hex"),
    keyVersion: version
  };
}

/**
 * Derives identifiers for many numbers at once.
 *
 * Preserves no association with the caller's ordering or original strings --
 * the result is a bare set, so nothing downstream can map an identifier back
 * to which contact produced it.
 */
export function deriveMatchIdentifiers(
  e164Numbers: readonly string[],
  version: number = ACTIVE_KEY_VERSION
): string[] {
  const secret = matchSecret(version);
  const seen = new Set<string>();
  for (const e164 of e164Numbers) {
    seen.add(createHmac("sha256", secret).update(e164).digest("hex"));
  }
  return [...seen];
}

/**
 * Constant-time comparison, for anywhere an identifier is checked directly.
 *
 * Not used by the batched match (a database `in (...)` does the work), but
 * present so that any future single-identifier check cannot leak information
 * through timing.
 */
export function identifiersMatch(a: string, b: string): boolean {
  const left = Buffer.from(a, "hex");
  const right = Buffer.from(b, "hex");
  // timingSafeEqual throws on length mismatch, which is itself an early exit;
  // comparing lengths first keeps that failure explicit rather than thrown.
  if (left.length !== right.length || left.length === 0) return false;
  return timingSafeEqual(left, right);
}
