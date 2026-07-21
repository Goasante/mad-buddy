import { NextResponse } from "next/server";
import { resolveApiUser } from "@/lib/api/auth";
import { preflightResponse, withCors } from "@/lib/api/cors";
import { savePrivacySetup } from "@/lib/onboarding/complete";

export function OPTIONS(request: Request) {
  return preflightResponse(request);
}

// Save the initial privacy setup (glow audience/duration, waves/pings, etc.).
// Shared with `savePrivacySetupAction`. Hidden = Ghost Mode until the user opts in.
export async function POST(request: Request) {
  const auth = await resolveApiUser(request);
  if (!auth) {
    return withCors(NextResponse.json({ error: "Authentication required." }, { status: 401 }), request);
  }

  const input = await request.json().catch(() => null);
  const result = await savePrivacySetup(auth.user.id, input);

  return withCors(NextResponse.json(result, { status: result.ok ? 200 : 400 }), request);
}
