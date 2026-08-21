import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { calculateAge } from "@/lib/profile/birth-date";
import {
  LINKR_MINIMUM_AGE,
  LINKR_UNDERAGE_MESSAGE,
  resolveActivationRequirements
} from "@/lib/linkr/rules";

/**
 * The 18+ gate, and the boundary that keeps it honest.
 *
 * Linkr consumes age eligibility; it does not own a date of birth. Profile is
 * the single authority for identity, so there is exactly one answer to how old
 * somebody is and one place it can be corrected.
 */

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const activation = read("components/linkr/linkr-activation.tsx");
const page = read("components/linkr/linkr-page.tsx");
const service = read("lib/linkr/profile-service.ts");
const candidate = read("lib/linkr/candidate-service.ts");
const dobService = read("lib/profile/date-of-birth-service.ts");
const dobMigration = read("supabase/migrations/20260820120000_atomic_profile_date_of_birth.sql");
const profileService = read("lib/profile/service.ts");
const actions = read("app/(app)/linkr-actions.ts");

describe("Linkr does not own the date of birth", () => {
  it("has no date input anywhere in Linkr", () => {
    // L3 made it a real control inside Linkr; L4 moved the concern to Profile,
    // so there is no longer a Linkr control that could regress.
    expect(activation).not.toMatch(/type="date"/);
    expect(activation).not.toContain("linkr-dob");
  });

  it("never writes profile_birth_details from Linkr", () => {
    expect(service).not.toMatch(/profile_birth_details[\s\S]{0,200}(upsert|insert\(|update\()/);
    expect(actions).not.toContain("setDateOfBirth");
  });

  it("only READS the derived age", () => {
    expect(service).toContain("resolveAge");
    expect(service).toMatch(/from\("profile_birth_details"\)[\s\S]{0,80}\.select\(/);
  });
});

describe("activation requirements", () => {
  it("asks for a date of birth when none is on file", () => {
    const r = resolveActivationRequirements({ age: null, hasPrimaryPhoto: true });
    expect(r.needsDateOfBirth).toBe(true);
    expect(r.canActivate).toBe(false);
    expect(r.profileMessage).toMatch(/date of birth/);
  });

  it("asks for a photo when the date is present", () => {
    const r = resolveActivationRequirements({ age: 24, hasPrimaryPhoto: false });
    expect(r.needsDateOfBirth).toBe(false);
    expect(r.needsPhoto).toBe(true);
    expect(r.profileMessage).toMatch(/profile photo/);
  });

  it("allows activation once both are satisfied", () => {
    const r = resolveActivationRequirements({ age: 24, hasPrimaryPhoto: true });
    expect(r.canActivate).toBe(true);
    expect(r.profileMessage).toBeNull();
  });

  it("treats underage as an ANSWER, not an outstanding step", () => {
    // There is nothing to complete, so no "complete your profile" instruction
    // and no editor is offered.
    const r = resolveActivationRequirements({ age: 16, hasPrimaryPhoto: true });
    expect(r.underage).toBe(true);
    expect(r.canActivate).toBe(false);
    expect(r.profileMessage).toBeNull();
    expect(LINKR_UNDERAGE_MESSAGE).toMatch(/18 and older/);
  });

  it("keeps underage distinct from missing", () => {
    const missing = resolveActivationRequirements({ age: null, hasPrimaryPhoto: true });
    const under = resolveActivationRequirements({ age: 15, hasPrimaryPhoto: true });
    expect(missing.needsDateOfBirth).toBe(true);
    expect(missing.underage).toBe(false);
    expect(under.needsDateOfBirth).toBe(false);
    expect(under.underage).toBe(true);
  });

  it("offers an underage person no way to change their age from Linkr", () => {
    expect(activation).not.toMatch(/Change age|Try another birthday/i);
    expect(activation).toMatch(/requirements\.underage \?[\s\S]{0,200}LINKR_UNDERAGE_MESSAGE/);
  });
});

describe("birthday boundaries", () => {
  /**
   * Age is derived from the FULL date, never `currentYear - birthYear`: an
   * off-by-one at the boundary is the difference between admitting a
   * 17-year-old and refusing an adult.
   */
  it("turns 18 today -> eligible", () => {
    expect(calculateAge("2008-08-19", "2026-08-19")).toBe(18);
    expect(resolveActivationRequirements({ age: 18, hasPrimaryPhoto: true }).underage).toBe(false);
  });

  it("turns 18 tomorrow -> still 17, ineligible", () => {
    expect(calculateAge("2008-08-20", "2026-08-19")).toBe(17);
    expect(resolveActivationRequirements({ age: 17, hasPrimaryPhoto: true }).underage).toBe(true);
  });

  it("birthday was yesterday -> eligible", () => {
    expect(calculateAge("2008-08-18", "2026-08-19")).toBe(18);
  });

  it("handles a leap-day birthday", () => {
    expect(calculateAge("2008-02-29", "2026-02-28")).toBe(17);
    expect(calculateAge("2008-02-29", "2026-03-01")).toBe(18);
  });

  it("is not year subtraction", () => {
    expect(calculateAge("2008-12-31", "2026-01-01")).toBe(17);
    expect(calculateAge("2008-01-01", "2026-12-31")).toBe(18);
  });

  it("admits exactly the minimum age and refuses one below", () => {
    expect(
      resolveActivationRequirements({ age: LINKR_MINIMUM_AGE, hasPrimaryPhoto: true }).canActivate
    ).toBe(true);
    expect(
      resolveActivationRequirements({ age: LINKR_MINIMUM_AGE - 1, hasPrimaryPhoto: true }).canActivate
    ).toBe(false);
  });
});

describe("the server is the age authority", () => {
  it("re-derives age from the stored date before enabling Linkr", () => {
    expect(service).toMatch(/export async function enableLinkr[\s\S]*?resolveAge\(admin, userId\)/);
    expect(service).toMatch(/export async function enableLinkr[\s\S]*?age === null[\s\S]*?return \{ ok: false/);
    expect(service).toMatch(/export async function enableLinkr[\s\S]*?age < 18[\s\S]*?return \{ ok: false/);
  });

  it("accepts no age from the client at all", () => {
    const start = service.indexOf("const activationSchema");
    const schema = service.slice(start, service.indexOf("});", start) + 3);
    expect(schema).toMatch(/z\.object\(\{\s*intent:/);
    expect(schema).not.toMatch(/\bage\b|dateOfBirth|date_of_birth/);
  });

  it("requires the canonical Profile photo at the server activation boundary", () => {
    expect(service).toMatch(/export async function enableLinkr[\s\S]*?hasProfilePicture\(admin, userId\)/);
  });

  it("filters active suspensions in the batched candidate authority", () => {
    expect(candidate).toContain('.from("user_restrictions")');
    expect(candidate).toContain('"suspended_temporary", "suspended_permanent"');
    expect(candidate).toContain("restricted: restrictedIds.has(id)");
  });
});

describe("Profile owns date-of-birth correction", () => {
  it("allows exactly one self-serve correction", () => {
    /**
     * Onboarding was the only writer and treats the field as optional, so a
     * mistyped date was a dead end -- the product's whole answer was "your
     * date of birth is already set". One correction fixes an honest mistake;
     * unlimited edits would make the 18+ gate a formality.
     */
    expect(dobMigration).toContain("correction_used_at is not null");
    expect(dobService).toMatch(/already corrected your date of birth[\s\S]{0,80}support/);
  });

  it("does not spend the correction on a first-time save", () => {
    expect(dobMigration).toContain("return query select 'created'::text, true");
  });

  it("does not spend the correction when the date is unchanged", () => {
    expect(dobMigration).toMatch(/v_existing\.date_of_birth = p_date[\s\S]{0,140}'unchanged'/);
    const unchangedBranch = dobMigration.slice(
      dobMigration.indexOf("if v_existing.date_of_birth = p_date"),
      dobMigration.indexOf("if v_existing.correction_used_at is not null")
    );
    expect(unchangedBranch).not.toContain("correction_used_at =");
  });

  it("stores an under-18 date honestly and lets the gate refuse", () => {
    // Rejecting the save would teach somebody to enter a different date.
    expect(dobService).toMatch(/Deliberately accepts an under-18 date/);
  });

  it("keeps the budget in server state, not the client", () => {
    expect(dobService).toContain('.rpc("save_profile_date_of_birth"');
    expect(dobMigration).toContain("for update");
    expect(dobMigration).toContain('drop policy if exists "profile birth details owner update"');
    expect(profileService).not.toMatch(/from\("profile_birth_details"\)[\s\S]{0,180}(upsert|delete)/);
  });
});

describe("raw date of birth never leaves the server", () => {
  it("is absent from the candidate projection", () => {
    expect(candidate).not.toMatch(/date_of_birth/);
    expect(candidate).toMatch(/age: number \| null/);
  });

  it("is absent from the activation screen's props", () => {
    expect(activation).toMatch(/age\?: number \| null/);
    expect(activation).not.toMatch(/dateOfBirth/);
  });

  it("is not handed to the client by the page", () => {
    expect(page).toContain("age={profile?.age ?? null}");
    expect(page).not.toMatch(/date_of_birth/);
  });
});

describe("mutation tests -- these must bite", () => {
  it("BITES: removing the server-side age check from enableLinkr", () => {
    const enable = service.slice(service.indexOf("export async function enableLinkr"));
    expect(enable.slice(0, 900)).toContain("age < 18");
  });

  it("BITES: treating a missing date of birth as eligible", () => {
    expect(resolveActivationRequirements({ age: null, hasPrimaryPhoto: true }).canActivate).toBe(
      false
    );
  });

  it("BITES: naive year subtraction for age", () => {
    expect(calculateAge("2008-12-31", "2026-06-01")).toBe(17);
  });

  it("BITES: leaking a raw date of birth to a candidate card", () => {
    expect(candidate).not.toMatch(/date_of_birth|dateOfBirth/);
  });

  it("BITES: giving Linkr a date-of-birth writer again", () => {
    expect(actions).not.toMatch(/setDateOfBirthAction/);
  });

  it("BITES: making the correction budget unlimited", () => {
    expect(dobMigration).toContain("if v_existing.correction_used_at is not null");
    expect(dobMigration).toContain("profile_birth_details:correction_locked");
  });
});
