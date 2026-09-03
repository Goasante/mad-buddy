import { NextResponse } from "next/server";
import { resolveApiUser } from "@/lib/api/auth";
import { preflightResponse, withCors } from "@/lib/api/cors";
import { updateProfile } from "@/lib/profile/service";
import { dateKeyInTimeZone, deriveBirthProfile } from "@/lib/profile/birth-date";
import { DEFAULT_RECIPIENT_TIMEZONE } from "@/lib/notifications/preferences";
import { loadEffectivePlan } from "@/lib/billing/service";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { loadProfileIdentitySummary } from "@/lib/profile/identity-service";
import { loadJourney } from "@/lib/journey/journey-service";
import { readBuddyScoreSnapshot } from "@/lib/engagement/buddy-score-service";

export function OPTIONS(request: Request) {
  return preflightResponse(request);
}

export async function GET(request: Request) {
  const auth = await resolveApiUser(request);
  if (!auth) {
    return withCors(NextResponse.json({ error: "Authentication required." }, { status: 401 }), request);
  }

  const admin = createSupabaseAdminClient();

  // Resolve the Buddy Score ONCE, read-only, and share it with both consumers.
  // Identity and Journey each used to load it independently, and loadBuddyScore
  // reconciles -- so a plain GET performed two reconciliations, two
  // auth.admin.getUserById lookups and two ledger UPSERTs. Presentation must
  // not mutate score state; /buddy-score remains the canonical page that
  // reconciles.
  const score = await readBuddyScoreSnapshot(admin, auth.user.id);

  const [{ data: birthDetails }, { data: privacy }, plan, identity, journey] = await Promise.all([
    auth.supabase
      .from("profile_birth_details")
      .select("date_of_birth")
      .eq("user_id", auth.user.id)
      .maybeSingle(),
    auth.supabase
      .from("profile_field_privacy")
      .select("field_name, visibility")
      .eq("user_id", auth.user.id)
      .in("field_name", ["birthday", "age", "zodiac"]),
    loadEffectivePlan(admin, auth.user.id),
    loadProfileIdentitySummary(admin, auth.user.id, "self", { score }),
    loadJourney(admin, auth.user.id, new Date(), { score })
  ]);
  const dayKey = dateKeyInTimeZone(new Date(), DEFAULT_RECIPIENT_TIMEZONE);
  const birthProfile = birthDetails?.date_of_birth ? deriveBirthProfile(birthDetails.date_of_birth, dayKey) : null;
  const readVisibility = (fieldName: "birthday" | "age" | "zodiac") =>
    privacy?.find((row) => row.field_name === fieldName)?.visibility === "approved_muddies"
      ? "approved_muddies"
      : "only_me";

  return withCors(
    NextResponse.json({
      birth: {
        dateOfBirth: birthDetails?.date_of_birth ?? "",
        birthdayToday: birthProfile?.birthdayToday ?? false,
        age: birthProfile?.age ?? null,
        zodiacSign: birthProfile?.zodiacSign ?? null,
        birthdayTomorrow: birthProfile?.birthdayTomorrow ?? false,
        birthdayCountdownDays: birthProfile?.birthdayCountdownDays ?? null,
        nextBirthdayDate: birthProfile?.nextBirthdayDate ?? null,
        birthdayVisibility: readVisibility("birthday"),
        ageVisibility: readVisibility("age"),
        zodiacVisibility: readVisibility("zodiac")
      },
      plan,
      identity,
      journey
    }),
    request
  );
}

// Update core profile fields (name/username/bio/mood). Shared with
// `updateProfileAction`; runs under the caller's RLS-scoped client.
export async function POST(request: Request) {
  const auth = await resolveApiUser(request);
  if (!auth) {
    return withCors(NextResponse.json({ error: "Authentication required." }, { status: 401 }), request);
  }

  const input = await request.json().catch(() => null);
  const result = await updateProfile(auth.supabase, auth.user.id, input);

  return withCors(NextResponse.json(result, { status: result.ok ? 200 : 400 }), request);
}
