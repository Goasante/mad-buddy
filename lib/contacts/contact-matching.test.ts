import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { stripComments } from "@/lib/content/strip-comments";
import { MAX_CONTACT_BATCH, MIN_CONTACT_BATCH } from "@/lib/contacts/contact-matching";
import {
  ACTIVE_KEY_VERSION,
  MissingMatchSecretError,
  deriveMatchIdentifier,
  deriveMatchIdentifiers,
  identifiersMatch,
  matchingConfigured
} from "@/lib/contacts/match-identifier";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const matching = stripComments(read("lib/contacts/contact-matching.ts"));
const route = stripComments(read("app/api/contacts/match/route.ts"));
const identifier = stripComments(read("lib/contacts/match-identifier.ts"));
const migration = read("supabase/migrations/20260809120000_phone_identity.sql");

const TEST_SECRET = "a".repeat(48);
const OTHER_SECRET = "b".repeat(48);

let originalSecret: string | undefined;

beforeEach(() => {
  originalSecret = process.env.CONTACT_MATCH_HMAC_SECRET;
  process.env.CONTACT_MATCH_HMAC_SECRET = TEST_SECRET;
});

afterEach(() => {
  if (originalSecret === undefined) delete process.env.CONTACT_MATCH_HMAC_SECRET;
  else process.env.CONTACT_MATCH_HMAC_SECRET = originalSecret;
});

// ---------------------------------------------------------------------------
// 20. The identifier itself
// ---------------------------------------------------------------------------

describe("matching identifiers are keyed, not merely hashed", () => {
  it("produces a stable identifier for the same number", () => {
    const first = deriveMatchIdentifier("+233241234567");
    const second = deriveMatchIdentifier("+233241234567");
    expect(first.identifier).toBe(second.identifier);
    expect(first.identifier).toMatch(/^[0-9a-f]{64}$/);
  });

  it("produces a different identifier under a different key", () => {
    // THE WHOLE POINT. An unsalted SHA-256 of a nine-digit national number is
    // reversible offline in minutes; the key is what makes an exfiltrated
    // column inert.
    const withFirst = deriveMatchIdentifier("+233241234567").identifier;
    process.env.CONTACT_MATCH_HMAC_SECRET = OTHER_SECRET;
    const withSecond = deriveMatchIdentifier("+233241234567").identifier;
    expect(withSecond).not.toBe(withFirst);
  });

  it("is not a plain hash of the number", () => {
    // A bare sha256 would be identical regardless of key.
    const plain = createHash("sha256").update("+233241234567").digest("hex");
    expect(deriveMatchIdentifier("+233241234567").identifier).not.toBe(plain);
  });

  it("refuses to derive without a configured secret", () => {
    // Never falls back to a default: a hard-coded key would make every
    // identifier recomputable by anyone with the source.
    delete process.env.CONTACT_MATCH_HMAC_SECRET;
    expect(() => deriveMatchIdentifier("+233241234567")).toThrow(MissingMatchSecretError);
    expect(matchingConfigured()).toBe(false);
  });

  it("refuses a secret too short to be worth anything", () => {
    process.env.CONTACT_MATCH_HMAC_SECRET = "short";
    expect(() => deriveMatchIdentifier("+233241234567")).toThrow(MissingMatchSecretError);
  });

  it("records the key version, so rotation does not break matching", () => {
    expect(deriveMatchIdentifier("+233241234567").keyVersion).toBe(ACTIVE_KEY_VERSION);
    expect(migration).toContain("match_key_version smallint not null default 1");
  });

  it("deduplicates a batch without preserving order", () => {
    // Nothing downstream may map an identifier back to which contact produced
    // it.
    const result = deriveMatchIdentifiers(["+233241234567", "+233241234567", "+447911123456"]);
    expect(result).toHaveLength(2);
  });

  it("compares in constant time", () => {
    const a = deriveMatchIdentifier("+233241234567").identifier;
    expect(identifiersMatch(a, a)).toBe(true);
    expect(identifiersMatch(a, deriveMatchIdentifier("+447911123456").identifier)).toBe(false);
    // Length mismatch must not throw.
    expect(identifiersMatch(a, "abcd")).toBe(false);
    expect(identifiersMatch("", "")).toBe(false);
  });

  it("keeps the secret server-side", () => {
    expect(read("lib/contacts/match-identifier.ts")).toContain('import "server-only"');
    expect(identifier).not.toContain("NEXT_PUBLIC");
  });
});

// ---------------------------------------------------------------------------
// 1, 2, 5. Enumeration and access
// ---------------------------------------------------------------------------

describe("the endpoint cannot be used to enumerate accounts", () => {
  it("requires authentication", () => {
    expect(route).toContain("resolveApiUser(request)");
    expect(route).toContain('{ error: "Authentication required." }, { status: 401 }');
  });

  it("offers no single-number lookup", () => {
    // A GET taking one phone would answer "does this person have an account",
    // which no rate limit makes safe.
    expect(route).not.toContain("export async function GET");
    expect(route).toContain("export async function POST");
    expect(route).not.toContain("searchParams");
  });

  it("refuses a batch small enough to attribute a match", () => {
    // A batch of one is a lookup wearing a batch's clothing.
    expect(MIN_CONTACT_BATCH).toBeGreaterThanOrEqual(5);
    expect(matching).toContain("normalised.length < MIN_CONTACT_BATCH");
  });

  it("counts USABLE numbers against the floor, not submitted strings", () => {
    // Otherwise padding with junk would satisfy the minimum while still
    // asking about one real number.
    const check = matching.slice(matching.indexOf("const normalised = normalisePhoneNumbers"));
    expect(check.indexOf("normalised.length < MIN_CONTACT_BATCH")).toBeGreaterThan(-1);
  });

  it("bounds the batch before doing any work", () => {
    expect(MAX_CONTACT_BATCH).toBeLessThanOrEqual(1000);
    expect(route).toContain(".max(MAX_CONTACT_BATCH)");
    // Enforced in the schema, so an oversized array is rejected before
    // normalising every string in it.
    expect(route).toContain("const bodySchema = z.object({");
  });

  it("rate limits before parsing the body", () => {
    const limitAt = route.indexOf('consumeRateLimit({ action: "contacts.match"');
    const parseAt = route.indexOf("bodySchema.safeParse");
    expect(limitAt).toBeGreaterThan(-1);
    expect(limitAt).toBeLessThan(parseAt);
  });

  it("never reveals which submitted number matched", () => {
    // The response carries profiles and counts, never a mapping.
    expect(route).toContain("matches: result.matches");
    expect(route).toContain("submitted: result.submitted");
    expect(matching).not.toContain("matchedNumbers");
    expect(matching).not.toContain("byNumber");
  });
});

// ---------------------------------------------------------------------------
// 3, 4. Malformed and oversized input
// ---------------------------------------------------------------------------

describe("input is bounded and validated server-side", () => {
  it("caps the length of any single submitted string", () => {
    expect(route).toContain("z.string().max(40)");
  });

  it("normalises server-side rather than trusting the client", () => {
    // A client-supplied identifier could be a hash it never derived from a
    // real number; a client-supplied E.164 may differ from the server's.
    expect(matching).toContain("normalisePhoneNumbers(rawNumbers, region)");
    expect(matching).toContain("deriveMatchIdentifiers(normalised)");
    expect(route).toContain("phoneNumbers: z");
    expect(route).not.toContain("identifiers:");
    expect(route).not.toContain("hmac");
  });

  it("validates the region rather than passing it through", () => {
    expect(route).toContain("/^[A-Z]{2}$/");
  });
});

// ---------------------------------------------------------------------------
// 6, 7, 8, 9. Eligibility gates
// ---------------------------------------------------------------------------

describe("only eligible accounts are ever returned", () => {
  it("filters discovery in the query, not after it", () => {
    // An account with discovery off produces no row at all, so it is
    // indistinguishable from one that does not exist.
    expect(matching).toContain('.eq("contact_discovery_enabled", true)');
  });

  it("excludes anyone blocked in either direction", () => {
    // A blocked person must not reappear because their number is still saved.
    expect(matching).toContain('.or(`blocker_id.eq.${viewerId},blocked_id.eq.${viewerId}`)');
    expect(matching).toContain("blockedIds.has(profile.user_id)");
  });

  it("excludes deleted accounts", () => {
    // Anchored on the guarantee rather than the loop shape: the filter moved
    // from a `continue` to a predicate when the projection gained the marks,
    // and a soft-deleted account must stay out either way.
    expect(matching).toContain("profile.deleted_at");
    expect(matching).toMatch(/deleted_at\) return false|deleted_at\) continue/);
  });

  it("excludes people who asked not to be found", () => {
    // Ghost mode hides someone from proximity; it hides them here too.
    expect(matching).toContain('profile.visibility_status === "ghost"');
  });

  it("never returns the viewer to themselves", () => {
    // Most people have their own number in their own contacts.
    expect(matching).toContain("id !== viewerId");
  });

  it("fails closed on an unconfigured secret", () => {
    // Returns an honest error rather than an empty match list, which would
    // read as "nobody you know is here".
    expect(matching).toContain('reason: "unconfigured"');
    expect(matching).toContain("if (!matchingConfigured())");
  });
});

// ---------------------------------------------------------------------------
// 13, 14. No raw phone leaves the server
// ---------------------------------------------------------------------------

describe("no phone number is returned or logged", () => {
  it("projects only safe profile fields", () => {
    // ENUMERATED, so a future column has to be added here deliberately. The
    // list grew when results gained the canonical marks -- every entry is
    // something the viewer can already read on that person's profile, and
    // none of it says anything about a phone number.
    const profileSelect = matching.slice(matching.indexOf('from("profiles")'));
    const opened = profileSelect.indexOf('.select("') + '.select("'.length;
    const columns = profileSelect
      .slice(opened, profileSelect.indexOf('"', opened))
      .split(",")
      .map((column) => column.trim());

    expect(columns).toEqual([
      "user_id",
      "full_name",
      "username",
      "avatar_url",
      "deleted_at",
      "visibility_status",
      "trusted_member_since"
    ]);

    // The projection type carries no number and no identifier.
    expect(matching).not.toContain("phoneE164:");
    expect(matching).not.toContain("phone_e164,");
  });

  it("never selects the number during matching", () => {
    // Matching compares HMACs; the raw column is never read.
    const query = matching.slice(matching.indexOf('from("user_phone_identities")'));
    expect(query.slice(0, 200)).toContain('.select("user_id")');
    expect(query.slice(0, 200)).not.toContain("phone_e164");
  });

  it("logs no number, identifier or contact name", () => {
    const logCalls = [...matching.matchAll(/logBackendEvent\(([\s\S]*?)\}\)/g)].map((match) => match[0]);
    expect(logCalls.length).toBeGreaterThan(0);
    for (const call of logCalls) {
      for (const forbidden of ["rawNumbers", "normalised", "identifiers", "e164", "hmac"]) {
        expect(call, `log must not carry ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it("returns counts rather than the matched numbers", () => {
    expect(matching).toContain("submitted: rawNumbers.length");
    expect(matching).toContain("usable: normalised.length");
  });

  it("is never cached", () => {
    // A match list is per-viewer and changes with blocks and settings.
    expect(route).toContain('"Cache-Control": "private, no-store"');
  });
});

// ---------------------------------------------------------------------------
// 12. Dormant duplicates
// ---------------------------------------------------------------------------

describe("duplicate dormant claims behave predictably", () => {
  it("keeps the uniqueness constraint partial on discovery", () => {
    // Two accounts may hold the same number while both are dormant, so a real
    // number change is not blocked by an abandoned claim.
    expect(migration).toContain("create unique index if not exists user_phone_identities_active_phone_idx");
    const index = migration.slice(migration.indexOf("user_phone_identities_active_phone_idx"));
    expect(index.slice(0, 200)).toContain("where contact_discovery_enabled");
  });

  it("matches nobody while both rows stay dormant", () => {
    // Eligibility requires the flag, so neither dormant row is returned.
    expect(matching).toContain('.eq("contact_discovery_enabled", true)');
  });

  it("documents first-to-enable-wins", () => {
    // The partial index makes the second enable impossible, so matching
    // returns exactly one profile rather than two or an arbitrary one.
    expect(read("lib/contacts/contact-matching.ts")).toContain("first-to-enable wins");
  });

  it("indexes matching on the identifier, not the number", () => {
    expect(migration).toContain("create index if not exists user_phone_identities_match_idx");
    expect(migration).toContain("on public.user_phone_identities (match_hmac, match_key_version)");
  });
});

// ---------------------------------------------------------------------------
// 15, 16, 18. Write protection
// ---------------------------------------------------------------------------

describe("matching writes nothing", () => {
  it("stores no contact the caller submitted", () => {
    // An address book must not become a server-side copy. Unmatched numbers
    // exist only for the life of the request.
    for (const write of [".insert(", ".upsert(", ".update("]) {
      expect(matching, `matching must not ${write}`).not.toContain(write);
    }
  });

  it("cannot set verification or discovery state", () => {
    expect(matching).not.toContain("phone_verified_at");
    expect(matching).not.toContain("contact_discovery_enabled: true");
  });

  it("keeps the service server-only", () => {
    expect(read("lib/contacts/contact-matching.ts")).toContain('import "server-only"');
  });
});
