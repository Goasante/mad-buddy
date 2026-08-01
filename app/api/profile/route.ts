import { NextResponse } from "next/server";
import { resolveApiUser } from "@/lib/api/auth";
import { preflightResponse, withCors } from "@/lib/api/cors";
import { updateProfile } from "@/lib/profile/service";
import { dateKeyInTimeZone, isBirthdayOnDate } from "@/lib/profile/birth-date";
import { DEFAULT_RECIPIENT_TIMEZONE } from "@/lib/notifications/preferences";

export function OPTIONS(request: Request) {
  return preflightResponse(request);
}

export async function GET(request: Request) {
  const auth = await resolveApiUser(request);
  if (!auth) {
    return withCors(NextResponse.json({ error: "Authentication required." }, { status: 401 }), request);
  }

  const [{ data: birthDetails }, { data: privacy }] = await Promise.all([
    auth.supabase
      .from("profile_birth_details")
      .select("date_of_birth")
      .eq("user_id", auth.user.id)
      .maybeSingle(),
    auth.supabase
      .from("profile_field_privacy")
      .select("field_name, visibility")
      .eq("user_id", auth.user.id)
      .in("field_name", ["birthday", "age", "zodiac"])
  ]);
  const readVisibility = (fieldName: "birthday" | "age" | "zodiac") =>
    privacy?.find((row) => row.field_name === fieldName)?.visibility === "approved_muddies"
      ? "approved_muddies"
      : "only_me";

  return withCors(
    NextResponse.json({
      birth: {
        dateOfBirth: birthDetails?.date_of_birth ?? "",
        birthdayToday: Boolean(
          birthDetails?.date_of_birth &&
            isBirthdayOnDate(
              birthDetails.date_of_birth,
              dateKeyInTimeZone(new Date(), DEFAULT_RECIPIENT_TIMEZONE)
            )
        ),
        birthdayVisibility: readVisibility("birthday"),
        ageVisibility: readVisibility("age"),
        zodiacVisibility: readVisibility("zodiac")
      }
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
