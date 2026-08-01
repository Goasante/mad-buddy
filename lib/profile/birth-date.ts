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

export function deriveBirthProfile(dateOfBirth: string, onDate: string) {
  return {
    age: calculateAge(dateOfBirth, onDate),
    zodiacSign: zodiacForDateOfBirth(dateOfBirth),
    birthdayToday: isBirthdayOnDate(dateOfBirth, onDate)
  };
}
