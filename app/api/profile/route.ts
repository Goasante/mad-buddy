import { NextResponse } from "next/server";
import { resolveApiUser } from "@/lib/api/auth";
import { preflightResponse, withCors } from "@/lib/api/cors";
import { updateProfile } from "@/lib/profile/service";
import { dateKeyInTimeZone, deriveBirthProfile } from "@/lib/profile/birth-date";
import { DEFAULT_RECIPIENT_TIMEZONE } from "@/lib/notifications/preferences";
import { loadEffectivePlan } from "@/lib/billing/service";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { loadProfileIdentitySummary } from "@/lib/profile/identity-service";
import { loadJourney, journeyMarks } from "@/lib/journey/journey-service";

export function OPTIONS(request: Request) {
  return preflightResponse(request);
}

export async function GET(request: Request) {
  // FORENSICS ONLY (perf/profile-forensics). Emits Server-Timing so the cost of
  // each phase can be measured instead of inferred. Returned product data is
  // unchanged, and no identifier or token is recorded.
  const marks: string[] = [];
  const t0 = performance.now();
  const phase = async <T,>(name: string, work: PromiseLike<T>): Promise<T> => {
    const started = performance.now();
    try {
      return await work;
    } finally {
      marks.push(`${name};dur=${(performance.now() - started).toFixed(1)}`);
    }
  };

  const auth = await phase("auth", resolveApiUser(request));
  if (!auth) {
    return withCors(NextResponse.json({ error: "Authentication required." }, { status: 401 }), request);
  }

  const admin = createSupabaseAdminClient();
  const [{ data: birthDetails }, { data: privacy }, plan, identity, journey] = await Promise.all([
    phase(
      "birth",
      auth.supabase
        .from("profile_birth_details")
        .select("date_of_birth")
        .eq("user_id", auth.user.id)
        .maybeSingle()
    ),
    phase(
      "privacy",
      auth.supabase
        .from("profile_field_privacy")
        .select("field_name, visibility")
        .eq("user_id", auth.user.id)
        .in("field_name", ["birthday", "age", "zodiac"])
    ),
    phase("plan", loadEffectivePlan(admin, auth.user.id)),
    phase("identity", loadProfileIdentitySummary(admin, auth.user.id, "self")),
    phase("journey", loadJourney(admin, auth.user.id))
  ]);
  marks.push(`j_score;dur=${(journeyMarks.score ?? 0).toFixed(1)}`);
  marks.push(`j_tours;dur=${(journeyMarks.tours ?? 0).toFixed(1)}`);
  marks.push(`total;dur=${(performance.now() - t0).toFixed(1)}`);
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
    }, { headers: { "Server-Timing": marks.join(", ") } }),
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
