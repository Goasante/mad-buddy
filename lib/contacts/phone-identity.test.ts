import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { stripComments } from "@/lib/content/strip-comments";
import { DELETION_TABLES } from "@/lib/account/deletion";
import {
  DEFAULT_PHONE_REGION,
  formatPhoneForOwner,
  normalisePhoneNumber,
  normalisePhoneNumbers,
  phoneHint
} from "@/lib/contacts/phone-normalization";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const service = stripComments(read("lib/contacts/phone-identity.ts"));
const normalisation = stripComments(read("lib/contacts/phone-normalization.ts"));
const migration = read("supabase/migrations/20260809120000_phone_identity.sql");

// ---------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------

describe("numbers normalise to E.164", () => {
  it("handles the Ghana national format", () => {
    // The brief's worked example.
    const result = normalisePhoneNumber("024 123 4567", "GH");
    expect(result.ok && result.e164).toBe("+233241234567");
  });

  it("accepts the same number written several ways", () => {
    // A person typing their own number, and an address book, disagree about
    // spacing, trunk prefixes and country codes constantly.
    for (const input of ["0241234567", "024 123 4567", "+233241234567", "233241234567", "+233 24 123 4567"]) {
      const result = normalisePhoneNumber(input, "GH");
      expect(result.ok && result.e164, `${input} should normalise`).toBe("+233241234567");
    }
  });

  it("is not Ghana-only", () => {
    expect(normalisePhoneNumber("+44 7911 123456").ok).toBe(true);
    expect(normalisePhoneNumber("07911123456", "GB").ok).toBe(true);
    expect(normalisePhoneNumber("+1 415 555 2671").ok).toBe(true);
  });

  it("defaults to Ghana without overriding an explicit country code", () => {
    expect(DEFAULT_PHONE_REGION).toBe("GH");

    // A +44 number passed with a GH default must still normalise as +44.
    //
    // Asserted on the E.164 OUTPUT, not on the inferred country: +44 is shared
    // by the UK, Guernsey, Jersey and the Isle of Man, so a mobile range can
    // legitimately resolve to any of them. That ambiguity is real and does not
    // matter here -- the E.164 form is identical either way, and E.164 is what
    // matching compares.
    const uk = normalisePhoneNumber("+447911123456", "GH");
    expect(uk.ok && uk.e164).toBe("+447911123456");
    expect(uk.ok && uk.country).not.toBe("GH");
  });

  it("rejects what cannot be a real number", () => {
    for (const input of ["", "   ", "not a number", "12345", "+", "00000000000"]) {
      expect(normalisePhoneNumber(input, "GH").ok, `${input} should fail`).toBe(false);
    }
  });

  it("gives a reason rather than throwing", () => {
    // Every caller has to handle failure -- a user mistyping, or a contact
    // list full of short codes and service numbers.
    expect(normalisePhoneNumber("", "GH")).toEqual({ ok: false, reason: "empty" });
    expect(normalisePhoneNumber("x".repeat(80), "GH")).toEqual({ ok: false, reason: "too_long" });
  });

  it("bounds the input it will attempt", () => {
    // Refuses obvious junk instead of handing the parser something enormous.
    expect(normalisePhoneNumber("1".repeat(500), "GH").ok).toBe(false);
  });
});

describe("batch normalisation suits a real address book", () => {
  it("drops unusable entries instead of failing the batch", () => {
    // One malformed contact must not make the whole feature unusable.
    const result = normalisePhoneNumbers(["024 123 4567", "not a number", "", null, undefined, "911"], "GH");
    expect(result).toEqual(["+233241234567"]);
  });

  it("deduplicates the same person saved twice", () => {
    const result = normalisePhoneNumbers(["0241234567", "+233241234567", "024 123 4567"], "GH");
    expect(result).toHaveLength(1);
  });

  it("returns an empty list rather than throwing on empty input", () => {
    expect(normalisePhoneNumbers([], "GH")).toEqual([]);
  });
});

describe("owner-facing display never becomes disclosure", () => {
  it("formats only for the person who owns the number", () => {
    expect(formatPhoneForOwner("+233241234567")).toContain("233");
  });

  it("reduces to a recognisable hint", () => {
    expect(phoneHint("+233241234567")).toBe("4567");
    expect(phoneHint("+1")).toBe("");
  });
});

// ---------------------------------------------------------------------------
// The number is never profile content
// ---------------------------------------------------------------------------

describe("the phone number cannot leak to another user", () => {
  it("lives in its own table, not on profiles", () => {
    // The profiles SELECT policy is ROW level -- "friends can view limited
    // profiles" grants the whole row -- so a phone column there would be
    // readable by every Muddy through a direct PostgREST read.
    expect(migration).toContain("create table if not exists public.user_phone_identities");
    expect(migration).not.toContain("alter table public.profiles");
  });

  it("is readable only by its owner", () => {
    expect(migration).toContain("enable row level security");
    const select = migration.slice(migration.indexOf('create policy "phone identity owner reads"'));
    expect(select.slice(0, 200)).toContain("using (auth.uid() = user_id)");
  });

  it("pins the destination row on write, so an identity cannot be moved", () => {
    const write = migration.slice(migration.indexOf('create policy "phone identity owner writes"'));
    expect(write.slice(0, 300)).toContain("with check (auth.uid() = user_id)");
  });

  it("never returns a raw number from the service to a caller about someone else", () => {
    // getPhoneIdentity is owner-only by construction; nothing here selects a
    // number for a user other than the one asking.
    expect(service).not.toContain("phone_e164, user_id");
    const getter = service.slice(service.indexOf("export async function getPhoneIdentity"));
    expect(getter).toContain('.eq("user_id", userId)');
  });
});

// ---------------------------------------------------------------------------
// Verification state
// ---------------------------------------------------------------------------

describe("no number is presented as verified", () => {
  it("never writes phone_verified_at", () => {
    // There is no verification yet. Writing a timestamp would claim proof of
    // ownership that does not exist.
    expect(service).not.toContain("phone_verified_at:");
  });

  it("refuses a client-supplied verification state at the database", () => {
    // The owner write policy would otherwise let a client set its own
    // verified timestamp.
    expect(migration).toContain("reject_client_phone_verification");
    expect(migration).toContain("phone_verified_at is set by verification only");
    expect(migration).toContain("<> 'service_role'");
  });

  it("keeps the column so OTP can be added without a schema change", () => {
    expect(migration).toContain("phone_verified_at timestamptz");
  });
});

// ---------------------------------------------------------------------------
// Discovery is a separate decision
// ---------------------------------------------------------------------------

describe("adding a number does not make anyone discoverable", () => {
  it("defaults discovery off", () => {
    expect(migration).toContain("contact_discovery_enabled boolean not null default false");
  });

  it("does not enable discovery as a side effect of saving a number", () => {
    // Storing a number and being findable by it are two consents.
    const save = service.slice(service.indexOf("export async function savePhoneNumber"));
    const upsert = save.slice(save.indexOf(".upsert("), save.indexOf(".select("));
    expect(upsert).not.toContain("contact_discovery_enabled");
  });

  it("refuses to enable discovery with no number saved", () => {
    const toggle = service.slice(service.indexOf("export async function setContactDiscovery"));
    expect(toggle).toContain("Add your phone number first.");
  });

  it("changes nothing for existing accounts", () => {
    // Additive only: no backfill, no update of existing rows.
    expect(migration).not.toMatch(/^\s*update\s+public\./im);
    expect(migration).not.toContain("insert into public.profiles");
  });
});

// ---------------------------------------------------------------------------
// Duplicate claims
// ---------------------------------------------------------------------------

describe("an unverified number cannot be taken from another account", () => {
  it("rejects the second claim rather than transferring it", () => {
    // Without verification a number is a claim, not proof. Silently moving it
    // would let anyone steal another person's contact matches by typing their
    // number.
    const save = service.slice(
      service.indexOf("export async function savePhoneNumber"),
      service.indexOf("export async function removePhoneNumber")
    );

    // The rejection must come BEFORE the write, or the number is transferred
    // and the check is decorative. Ordering is the guarantee here, not the
    // presence of the strings -- an earlier version of this test passed even
    // with the whole rejection branch deleted.
    const clashCheck = save.indexOf("existing.user_id !== userId");
    const rejection = save.indexOf('reason: "claimed"');
    const write = save.indexOf(".upsert(");

    expect(clashCheck, "must detect another account holding the number").toBeGreaterThan(-1);
    expect(rejection, "must reject rather than transfer").toBeGreaterThan(-1);
    expect(rejection).toBeLessThan(write);
    expect(clashCheck).toBeLessThan(write);
  });

  it("enforces it in the database, not only in the check", () => {
    // Two requests can both pass the application check before either writes.
    expect(migration).toContain("create unique index if not exists user_phone_identities_active_phone_idx");
    expect(migration).toContain("where contact_discovery_enabled");
  });

  it("re-checks when discovery is switched on", () => {
    // A dormant number can be claimed by someone else in the meantime.
    const toggle = service.slice(service.indexOf("export async function setContactDiscovery"));
    expect(toggle).toContain("already in use for contact discovery");
  });

  it("does not confirm whose account holds a claimed number", () => {
    // Otherwise the error message becomes a way to test whether a number is
    // registered.
    const save = service.slice(service.indexOf("export async function savePhoneNumber"));
    expect(save).not.toContain("belongs to");
    expect(save).not.toContain("@");
  });

  it("lets a dormant claim go, so a real number change is not blocked", () => {
    // The unique index is partial on the discovery flag.
    const indexBlock = migration.slice(migration.indexOf("user_phone_identities_active_phone_idx"));
    expect(indexBlock.slice(0, 200)).toContain("where contact_discovery_enabled");
  });
});

// ---------------------------------------------------------------------------
// Removal and deletion
// ---------------------------------------------------------------------------

describe("removal stops matching immediately", () => {
  it("hard-deletes rather than flagging", () => {
    // A soft-deleted row keeps producing matches for any query that forgets
    // the filter.
    const remove = service.slice(service.indexOf("export async function removePhoneNumber"));
    expect(remove).toContain('.delete().eq("user_id", userId)');
    expect(remove).not.toContain("deleted_at");
  });

  it("is purged when the account is deleted", () => {
    // A deleted person must not stay findable by anyone who has them saved.
    expect(DELETION_TABLES).toContain("user_phone_identities");
    const deletion = stripComments(read("lib/account/deletion.ts"));
    expect(deletion).toContain('admin.from("user_phone_identities").delete().eq("user_id", userId)');
  });

  it("also cascades if the auth user disappears another way", () => {
    expect(migration).toContain("references auth.users(id) on delete cascade");
  });
});

// ---------------------------------------------------------------------------
// Observability
// ---------------------------------------------------------------------------

describe("diagnostics never record the number", () => {
  it("logs a reason code, not the input", () => {
    expect(service).toContain("errorType: `phone_${normalised.reason}`");
    // No log call passes the number or the parsed result.
    expect(service).not.toContain("phone: e164");
    expect(service).not.toContain("phoneE164: input");
  });

  it("logs no raw input anywhere", () => {
    // [\s\S] rather than the `s` flag, which the tsconfig target predates.
    const logCalls = [...service.matchAll(/logBackendEvent\(([\s\S]*?)\)/g)].map((match) => match[0]);
    for (const call of logCalls) {
      expect(call, `log must not carry a number: ${call}`).not.toContain("input");
      expect(call).not.toContain("e164");
    }
  });
});

// ---------------------------------------------------------------------------
// Server authority
// ---------------------------------------------------------------------------

describe("the server owns normalisation", () => {
  it("re-normalises rather than trusting a client E.164 string", () => {
    // A caller could otherwise send a string that normalises one way for
    // matching and reads another way to a human.
    const save = service.slice(service.indexOf("export async function savePhoneNumber"));
    expect(save).toContain("normalisePhoneNumber(input, region)");
    expect(save).toContain("const { e164, country } = normalised");
  });

  it("keeps the identity service server-only", () => {
    expect(read("lib/contacts/phone-identity.ts")).toContain('import "server-only"');
  });

  it("uses the smaller metadata bundle", () => {
    // 82 KB against 154 KB for /max, which carries validation detail this
    // feature does not use.
    expect(normalisation).toContain('from "libphonenumber-js/min"');
    expect(normalisation).not.toContain('from "libphonenumber-js/max"');
  });
});
