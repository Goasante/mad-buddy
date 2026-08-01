import { describe, expect, it } from "vitest";
import {
  BIRTHDAY_WISHES,
  birthdayMomentCaption,
  birthdayMonthDay,
  birthdayTitle,
  birthdayWishClientId,
  isBirthdayActive,
  isBirthdayWish
} from "@/lib/profile/birthday-experience";

describe("birthday experience", () => {
  it("derives an active birthday only for the matching server day", () => {
    expect(isBirthdayActive("1990-08-01", "2026-08-01")).toBe(true);
    expect(isBirthdayActive("1990-08-01", "2026-08-02")).toBe(false);
  });

  it("handles the documented leap-day fallback", () => {
    expect(birthdayMonthDay("2025-02-28")).toEqual({ month: 2, day: 28, leapDayFallback: true });
    expect(isBirthdayActive("2000-02-29", "2025-02-28")).toBe(true);
    expect(isBirthdayActive("2000-02-29", "2024-02-28")).toBe(false);
  });

  it("uses a first name without exposing a birth year", () => {
    expect(birthdayTitle("Kofi Mensah")).toBe("It's Kofi's birthday today 🎉");
    expect(birthdayTitle("Kofi Mensah")).not.toMatch(/\d{4}/);
  });

  it("accepts only the canonical suggested wishes", () => {
    for (const wish of BIRTHDAY_WISHES) expect(isBirthdayWish(wish)).toBe(true);
    expect(isBirthdayWish("Send money")).toBe(false);
  });

  it("deduplicates a wish per sender, recipient, and local birthday day", () => {
    const first = birthdayWishClientId("11111111-1111-4111-8111-111111111111", "2026-08-01");
    expect(first).toBe(birthdayWishClientId("11111111-1111-4111-8111-111111111111", "2026-08-01"));
    expect(first).not.toBe(birthdayWishClientId("11111111-1111-4111-8111-111111111111", "2026-08-02"));
    expect(first.length).toBeLessThanOrEqual(64);
  });

  it("provides the optional Moment copy", () => {
    expect(birthdayMomentCaption()).toBe("It's my birthday today 🎉");
  });
});
