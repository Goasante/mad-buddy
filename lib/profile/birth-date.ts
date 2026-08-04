export const MAX_PROFILE_AGE = 120;

export const ZODIAC_SIGNS = [
  "Capricorn",
  "Aquarius",
  "Pisces",
  "Aries",
  "Taurus",
  "Gemini",
  "Cancer",
  "Leo",
  "Virgo",
  "Libra",
  "Scorpio",
  "Sagittarius"
] as const;

export type ZodiacSign = (typeof ZODIAC_SIGNS)[number];

type CalendarDate = { year: number; month: number; day: number };

const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export function parseCalendarDate(value: string): CalendarDate | null {
  const match = ISO_DATE_PATTERN.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (
    candidate.getUTCFullYear() !== year ||
    candidate.getUTCMonth() + 1 !== month ||
    candidate.getUTCDate() !== day
  ) {
    return null;
  }
  return { year, month, day };
}

export function dateKeyInTimeZone(now: Date, timeZone = "UTC"): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(now);
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${read("year")}-${read("month")}-${read("day")}`;
}

export function validateDateOfBirth(value: string, today = dateKeyInTimeZone(new Date())): string | null {
  const birth = parseCalendarDate(value);
  const current = parseCalendarDate(today);
  if (!birth) return "Enter a real date of birth.";
  if (!current) throw new Error("The comparison date must use YYYY-MM-DD.");
  if (value > today) return "Date of birth cannot be in the future.";
  if (calculateAge(value, today) > MAX_PROFILE_AGE) {
    return "Enter a date of birth within the last 120 years.";
  }
  return null;
}

export function calculateAge(dateOfBirth: string, onDate: string): number {
  const birth = parseCalendarDate(dateOfBirth);
  const current = parseCalendarDate(onDate);
  if (!birth || !current) throw new Error("Dates must be real calendar dates in YYYY-MM-DD format.");
  let age = current.year - birth.year;
  if (current.month < birth.month || (current.month === birth.month && current.day < birth.day)) age -= 1;
  return age;
}

export function zodiacForDateOfBirth(dateOfBirth: string): ZodiacSign {
  const birth = parseCalendarDate(dateOfBirth);
  if (!birth) throw new Error("Date of birth must be a real calendar date in YYYY-MM-DD format.");
  const key = birth.month * 100 + birth.day;
  if (key >= 1222 || key <= 119) return "Capricorn";
  if (key <= 218) return "Aquarius";
  if (key <= 320) return "Pisces";
  if (key <= 419) return "Aries";
  if (key <= 520) return "Taurus";
  if (key <= 620) return "Gemini";
  if (key <= 722) return "Cancer";
  if (key <= 822) return "Leo";
  if (key <= 922) return "Virgo";
  if (key <= 1022) return "Libra";
  if (key <= 1121) return "Scorpio";
  return "Sagittarius";
}

export function isBirthdayOnDate(dateOfBirth: string, onDate: string): boolean {
  const birth = parseCalendarDate(dateOfBirth);
  const current = parseCalendarDate(onDate);
  if (!birth || !current) throw new Error("Dates must be real calendar dates in YYYY-MM-DD format.");
  if (birth.month === current.month && birth.day === current.day) return true;
  const currentYearIsLeap = parseCalendarDate(`${current.year}-02-29`) !== null;
  return birth.month === 2 && birth.day === 29 && !currentYearIsLeap && current.month === 2 && current.day === 28;
}

function birthdayForYear(birth: CalendarDate, year: number): CalendarDate {
  const exact = parseCalendarDate(
    `${year}-${String(birth.month).padStart(2, "0")}-${String(birth.day).padStart(2, "0")}`
  );
  // Mad Buddy consistently observes a 29 February birthday on 28 February in
  // non-leap years. No stored date is changed by this display-only fallback.
  return exact ?? { year, month: 2, day: 28 };
}

function calendarDateKey(value: CalendarDate): string {
  return `${value.year}-${String(value.month).padStart(2, "0")}-${String(value.day).padStart(2, "0")}`;
}

/** Next observed birthday date, derived without ever changing the stored DOB. */
export function nextBirthdayDate(dateOfBirth: string, onDate: string): string {
  const birth = parseCalendarDate(dateOfBirth);
  const current = parseCalendarDate(onDate);
  if (!birth || !current) throw new Error("Dates must be real calendar dates in YYYY-MM-DD format.");

  let next = birthdayForYear(birth, current.year);
  const currentMs = Date.UTC(current.year, current.month - 1, current.day);
  const nextMs = Date.UTC(next.year, next.month - 1, next.day);
  if (nextMs < currentMs) {
    next = birthdayForYear(birth, current.year + 1);
  }
  return calendarDateKey(next);
}

/** Days until the next birthday, using the same Feb 29 fallback as birthday state. */
export function daysUntilBirthday(dateOfBirth: string, onDate: string): number {
  const current = parseCalendarDate(onDate);
  const next = parseCalendarDate(nextBirthdayDate(dateOfBirth, onDate));
  if (!current || !next) throw new Error("Dates must be real calendar dates in YYYY-MM-DD format.");
  const currentMs = Date.UTC(current.year, current.month - 1, current.day);
  const nextMs = Date.UTC(next.year, next.month - 1, next.day);
  return Math.round((nextMs - currentMs) / 86_400_000);
}

export function deriveBirthProfile(dateOfBirth: string, onDate: string) {
  const countdown = daysUntilBirthday(dateOfBirth, onDate);
  return {
    age: calculateAge(dateOfBirth, onDate),
    zodiacSign: zodiacForDateOfBirth(dateOfBirth),
    birthdayToday: countdown === 0,
    birthdayTomorrow: countdown === 1,
    birthdayCountdownDays: countdown,
    nextBirthdayDate: nextBirthdayDate(dateOfBirth, onDate)
  };
}

export type DerivedBirthProfile = ReturnType<typeof deriveBirthProfile>;

/**
 * Removes every birth detail the viewer is not authorised to see. The raw DOB
 * is deliberately not accepted in the returned shape, so callers cannot leak
 * it by spreading a database row into a public response.
 */
export function projectDerivedBirthProfile(
  derived: DerivedBirthProfile | null,
  access: { birthday: boolean; age: boolean; zodiac: boolean }
) {
  return {
    age: access.age ? (derived?.age ?? null) : null,
    zodiacSign: access.zodiac ? (derived?.zodiacSign ?? null) : null,
    birthdayToday: access.birthday ? (derived?.birthdayToday ?? false) : false,
    birthdayTomorrow: access.birthday ? (derived?.birthdayTomorrow ?? false) : false,
    birthdayCountdownDays: access.birthday ? (derived?.birthdayCountdownDays ?? null) : null,
    nextBirthdayDate: access.birthday ? (derived?.nextBirthdayDate ?? null) : null
  };
}
