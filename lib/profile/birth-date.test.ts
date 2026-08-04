import { describe, expect, it } from "vitest";
import {
  calculateAge,
  dateKeyInTimeZone,
  daysUntilBirthday,
  deriveBirthProfile,
  isBirthdayOnDate,
  nextBirthdayDate,
  projectDerivedBirthProfile,
  validateDateOfBirth,
  zodiacForDateOfBirth
} from "@/lib/profile/birth-date";
import { resolveFieldVisibility } from "@/lib/profile/rules";

describe("date of birth validation", () => {
  it("accepts real dates and rejects malformed, impossible, future, and unrealistic dates", () => {
    expect(validateDateOfBirth("2024-02-29", "2026-08-01")).toBeNull();
    expect(validateDateOfBirth("2025-02-29", "2026-08-01")).toMatch(/real date/);
    expect(validateDateOfBirth("01/08/2000", "2026-08-01")).toMatch(/real date/);
    expect(validateDateOfBirth("2027-01-01", "2026-08-01")).toMatch(/future/);
    expect(validateDateOfBirth("1900-01-01", "2026-08-01")).toMatch(/120 years/);
    expect(validateDateOfBirth("2026-08-01", "2026-08-01")).toBeNull();
  });

  it("calculates age without persisting it", () => {
    expect(calculateAge("2000-08-02", "2026-08-01")).toBe(25);
    expect(calculateAge("2000-08-01", "2026-08-01")).toBe(26);
  });

  it("handles leap-day birthdays consistently", () => {
    expect(isBirthdayOnDate("2000-02-29", "2024-02-29")).toBe(true);
    expect(isBirthdayOnDate("2000-02-29", "2025-02-28")).toBe(true);
    expect(isBirthdayOnDate("2000-02-29", "2025-03-01")).toBe(false);
  });

  it("derives a safe profile without returning the birth date", () => {
    expect(deriveBirthProfile("2000-08-01", "2026-08-01")).toEqual({
      age: 26,
      zodiacSign: "Leo",
      birthdayToday: true,
      birthdayTomorrow: false,
      birthdayCountdownDays: 0,
      nextBirthdayDate: "2026-08-01"
    });
  });

  it("calculates a safe birthday countdown without returning the birth year", () => {
    expect(daysUntilBirthday("1992-08-10", "2026-08-01")).toBe(9);
    expect(daysUntilBirthday("1992-01-10", "2026-08-01")).toBe(162);
    expect(daysUntilBirthday("2000-02-29", "2026-02-28")).toBe(0);
    expect(nextBirthdayDate("1992-01-10", "2026-08-01")).toBe("2027-01-10");
    expect(nextBirthdayDate("2000-02-29", "2025-01-01")).toBe("2025-02-28");
  });

  it("derives birthday tomorrow from the canonical countdown", () => {
    expect(deriveBirthProfile("1992-08-02", "2026-08-01")).toMatchObject({
      birthdayToday: false,
      birthdayTomorrow: true,
      birthdayCountdownDays: 1,
      nextBirthdayDate: "2026-08-02"
    });
  });

  it("uses an explicit timezone at date boundaries", () => {
    const now = new Date("2026-08-01T01:00:00.000Z");
    expect(dateKeyInTimeZone(now, "Pacific/Kiritimati")).toBe("2026-08-01");
    expect(dateKeyInTimeZone(now, "America/Los_Angeles")).toBe("2026-07-31");
    expect(deriveBirthProfile("2000-08-01", dateKeyInTimeZone(now, "Pacific/Kiritimati")).birthdayToday).toBe(true);
    expect(deriveBirthProfile("2000-08-01", dateKeyInTimeZone(now, "America/Los_Angeles")).birthdayTomorrow).toBe(true);
  }, 15_000);

  it("projects only authorised derived values and never the raw birth date", () => {
    const derived = deriveBirthProfile("2000-08-02", "2026-08-01");
    const hidden = projectDerivedBirthProfile(derived, { birthday: false, age: false, zodiac: false });
    expect(hidden).toEqual({
      age: null,
      zodiacSign: null,
      birthdayToday: false,
      birthdayTomorrow: false,
      birthdayCountdownDays: null,
      nextBirthdayDate: null
    });
    expect(hidden).not.toHaveProperty("dateOfBirth");

    expect(projectDerivedBirthProfile(derived, { birthday: true, age: false, zodiac: true })).toEqual({
      age: null,
      zodiacSign: "Leo",
      birthdayToday: false,
      birthdayTomorrow: true,
      birthdayCountdownDays: 1,
      nextBirthdayDate: "2026-08-02"
    });
  });

  it("shows owner fields while applying each Muddy privacy choice independently", () => {
    const derived = deriveBirthProfile("2000-08-02", "2026-08-01");
    const ownerCanSee = (visibility: "only_me" | "approved_muddies") =>
      resolveFieldVisibility({ visibility, relationship: "self" });
    const muddyCanSee = (visibility: "only_me" | "approved_muddies") =>
      resolveFieldVisibility({ visibility, relationship: "approved_muddy" });

    expect(
      projectDerivedBirthProfile(derived, {
        birthday: ownerCanSee("only_me"),
        age: ownerCanSee("only_me"),
        zodiac: ownerCanSee("only_me")
      })
    ).toMatchObject({ age: 25, zodiacSign: "Leo", birthdayTomorrow: true });

    expect(
      projectDerivedBirthProfile(derived, {
        birthday: muddyCanSee("approved_muddies"),
        age: muddyCanSee("only_me"),
        zodiac: muddyCanSee("only_me")
      })
    ).toEqual({
      age: null,
      zodiacSign: null,
      birthdayToday: false,
      birthdayTomorrow: true,
      birthdayCountdownDays: 1,
      nextBirthdayDate: "2026-08-02"
    });
  });
});

describe("zodiac boundaries", () => {
  const boundaries = [
    ["2000-12-22", "Capricorn"], ["2000-01-19", "Capricorn"],
    ["2000-01-20", "Aquarius"], ["2000-02-18", "Aquarius"],
    ["2000-02-19", "Pisces"], ["2000-03-20", "Pisces"],
    ["2000-03-21", "Aries"], ["2000-04-19", "Aries"],
    ["2000-04-20", "Taurus"], ["2000-05-20", "Taurus"],
    ["2000-05-21", "Gemini"], ["2000-06-20", "Gemini"],
    ["2000-06-21", "Cancer"], ["2000-07-22", "Cancer"],
    ["2000-07-23", "Leo"], ["2000-08-22", "Leo"],
    ["2000-08-23", "Virgo"], ["2000-09-22", "Virgo"],
    ["2000-09-23", "Libra"], ["2000-10-22", "Libra"],
    ["2000-10-23", "Scorpio"], ["2000-11-21", "Scorpio"],
    ["2000-11-22", "Sagittarius"], ["2000-12-21", "Sagittarius"]
  ] as const;

  it.each(boundaries)("maps %s to %s", (date, sign) => {
    expect(zodiacForDateOfBirth(date)).toBe(sign);
  });
});
