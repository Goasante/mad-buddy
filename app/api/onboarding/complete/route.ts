import { NextResponse } from "next/server";
import { resolveApiUser } from "@/lib/api/auth";
import { preflightResponse, withCors } from "@/lib/api/cors";
import { completeOnboarding } from "@/lib/onboarding/complete";

export function OPTIONS(request: Request) {
  return preflightResponse(request);
}

// Finish onboarding (profile + preferences + optional first Muddy). Shared with
// `completeOnboardingAction`.
export async function POST(request: Request) {
  const auth = await resolveApiUser(request);
  if (!auth) {
    return withCors(NextResponse.json({ error: "Authentication required." }, { status: 401 }), request);
  }

  const input = await request.json().catch(() => null);
  const result = await completeOnboarding(auth.user.id, input);

  return withCors(NextResponse.json(result, { status: result.ok ? 200 : 400 }), request);
}
