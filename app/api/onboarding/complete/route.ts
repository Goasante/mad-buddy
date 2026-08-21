import { NextResponse } from "next/server";
import { resolveApiUser } from "@/lib/api/auth";
import { preflightResponse, withCors } from "@/lib/api/cors";
import { completeOnboarding } from "@/lib/onboarding/complete";
import { FINALIZE_RECOVERABLE_MESSAGE, finalizeOnboarding } from "@/lib/onboarding/finalize";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export function OPTIONS(request: Request) {
  return preflightResponse(request);
}

// Finish onboarding (profile + preferences + optional first Muddy), then
// finalize through the same canonical primitive the web action uses.
//
// This route previously called completeOnboarding alone, which saves the
// profile but deliberately leaves is_onboarded = false — so a native user who
// finished onboarding was sent straight back to it on every launch, with no
// progress row and no privacy version ever written.
export async function POST(request: Request) {
  const auth = await resolveApiUser(request);
  if (!auth) {
    return withCors(NextResponse.json({ error: "Authentication required." }, { status: 401 }), request);
  }

  const input = await request.json().catch(() => null);
  const result = await completeOnboarding(auth.supabase, auth.user.id, input);
  if (!result.ok) {
    return withCors(NextResponse.json(result, { status: 400 }), request);
  }

  const finalized = await finalizeOnboarding(createSupabaseAdminClient(), auth.user.id);
  if (!finalized.ok) {
    // Recoverable: the profile is saved, and reopening the app resumes.
    return withCors(
      NextResponse.json({ ok: false, message: FINALIZE_RECOVERABLE_MESSAGE }, { status: 503 }),
      request
    );
  }

  return withCors(NextResponse.json(result, { status: 200 }), request);
}
