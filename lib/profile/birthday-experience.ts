import { isBirthdayOnDate, parseCalendarDate } from "@/lib/profile/birth-date";

export const BIRTHDAY_WISHES = [
  "Happy birthday! 🎂",
  "Have an amazing day! 🥳",
  "Sending you birthday wishes! 🎉",
  "Let's celebrate soon 🎁"
] as const;

export type BirthdayWish = (typeof BIRTHDAY_WISHES)[number];

export function isBirthdayWish(value: string): value is BirthdayWish {
  return (BIRTHDAY_WISHES as readonly string[]).includes(value);
}

export function birthdayTitle(displayName: string): string {
  const firstName = displayName.trim().split(/\s+/)[0] || "A Muddy";
  return `It's ${firstName}'s birthday today 🎉`;
}

export function birthdayMonthDay(dayKey: string): {
  month: number;
  day: number;
  leapDayFallback: boolean;
} {
  const date = parseCalendarDate(dayKey);
  if (!date) throw new Error("Birthday day keys must use YYYY-MM-DD.");
  const leapDayFallback = date.month === 2 && date.day === 28 && parseCalendarDate(`${date.year}-02-29`) === null;
  return { month: date.month, day: date.day, leapDayFallback };
}

export function isBirthdayActive(dateOfBirth: string, dayKey: string): boolean {
  return isBirthdayOnDate(dateOfBirth, dayKey);
}

export function birthdayWishClientId(targetUserId: string, dayKey: string): string {
  return `bday:${targetUserId}:${dayKey.replaceAll("-", "")}`;
}

export function birthdayMomentCaption(): string {
  return "It's my birthday today 🎉";
}
