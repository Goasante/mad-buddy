import "server-only";

import { z } from "zod";

import {
  calculateAge,
  dateKeyInTimeZone,
  validateDateOfBirth
} from "@/lib/profile/birth-date";
import { consumeRateLimit, rateLimitMessage } from "@/lib/security/rate-limit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * CANONICAL DATE OF BIRTH, and the only place it may be written.
 *
 * Profile owns identity. Every other surface -- Linkr, Moments, birthdays --
 * reads the derived age from here and never collects a date of its own.
 *
 * THE CORRECTION POLICY, and why it exists.
 *
 * Onboarding was the only writer, and it treats the field as optional, so a
 * person could arrive with no date at all or with a mistyped one and have no
 * way back: the product's entire answer was "your date of birth is already
 * set". That is a dead end for an honest mistake, and it is the reason a real
 * user got stuck behind a wrong date.
 *
 * Making it freely editable is the other failure: age gates the 18+ surfaces,
 * so an endlessly editable birthday is an endlessly bypassable gate.
 *
 * So: ONE self-serve correction, then locked.
 *
 *   - no date on file      -> set it, no correction consumed
 *   - date on file, unused -> correct it once, correction consumed
 *   - correction consumed  -> refused here, directed to support
 *
 * A single correction covers the realistic mistake (wrong year, transposed
 * digits, wrong date picked in a hurry) and does not cover "try birthdays
 * until one is over 18". `correctionUsed` is recorded on the row, so the
 * budget is server state a client cannot reset.
 */

export type DateOfBirthState = {
  /** The stored date, for the OWNER's own editor only. Never leaves Profile. */
  dateOfBirth: string | null;
  /** Derived, and the only form other surfaces receive. */
  age: number | null;
  /** Whether the one self-serve correction is still available. */
  canCorrect: boolean;
  /** Why not, when it is not. */
  lockedReason: "none" | "correction_used";
};

export type DateOfBirthResult = {
  ok: boolean;
  message: string;
  age?: number | null;
  /** True when the write consumed the single correction. */
  correctionUsed?: boolean;
};

const schema = z.string().trim().min(1, "Choose your date of birth.");

/** The owner's own view of their date of birth and what they may do with it. */
export async function loadDateOfBirthState(userId: string): Promise<DateOfBirthState> {
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("profile_birth_details")
    .select("date_of_birth, correction_used_at")
    .eq("user_id", userId)
    .maybeSingle();

  if (!data?.date_of_birth) {
    return { dateOfBirth: null, age: null, canCorrect: true, lockedReason: "none" };
  }

  let age: number | null = null;
  try {
    age = calculateAge(data.date_of_birth, dateKeyInTimeZone(new Date()));
  } catch {
    age = null;
  }

  const correctionUsed = Boolean(data.correction_used_at);
  return {
    dateOfBirth: data.date_of_birth,
    age,
    canCorrect: !correctionUsed,
    lockedReason: correctionUsed ? "correction_used" : "none"
  };
}

/**
 * Sets or corrects the canonical date of birth.
 *
 * Deliberately accepts an under-18 date. The person's real birthday is the
 * truth whatever it says, and refusing the save would teach them to enter a
 * different one; the 18+ surfaces then refuse on the server, which is where an
 * age gate belongs.
 */
export async function saveDateOfBirth(userId: string, value: unknown): Promise<DateOfBirthResult> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Choose your date of birth." };
  }

  const problem = validateDateOfBirth(parsed.data, dateKeyInTimeZone(new Date()));
  if (problem) return { ok: false, message: problem };

  const limit = await consumeRateLimit({ action: "linkr.profile", userId });
  if (!limit.allowed) return { ok: false, message: rateLimitMessage(limit.resetAt) };

  const admin = createSupabaseAdminClient();
  const { data: existing } = await admin
    .from("profile_birth_details")
    .select("date_of_birth, correction_used_at")
    .eq("user_id", userId)
    .maybeSingle();

  const isCorrection = Boolean(existing?.date_of_birth);

  if (isCorrection) {
    if (existing?.correction_used_at) {
      return {
        ok: false,
        message: "You've already corrected your date of birth. Contact support to change it again."
      };
    }
    // Re-saving the same date is not a correction, and must not spend the one
    // budget somebody may need for a real mistake.
    if (existing?.date_of_birth === parsed.data) {
      return { ok: true, message: "No change.", correctionUsed: false };
    }
  }

  const { error } = await admin.from("profile_birth_details").upsert(
    {
      user_id: userId,
      date_of_birth: parsed.data,
      // Stamped only when this write CHANGED an existing date, so setting a
      // date for the first time leaves the correction still available.
      ...(isCorrection ? { correction_used_at: new Date().toISOString() } : {}),
      updated_at: new Date().toISOString()
    },
    { onConflict: "user_id" }
  );
  if (error) return { ok: false, message: "Couldn't save that. Try again." };

  let age: number | null = null;
  try {
    age = calculateAge(parsed.data, dateKeyInTimeZone(new Date()));
  } catch {
    age = null;
  }

  return {
    ok: true,
    message: isCorrection ? "Date of birth corrected." : "Date of birth saved.",
    age,
    correctionUsed: isCorrection
  };
}
