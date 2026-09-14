import { NextResponse } from "next/server";
import { resolveApiUser } from "@/lib/api/auth";
import { preflightResponse, withCors } from "@/lib/api/cors";
import { setProfileInterests } from "@/lib/profile/interests-service";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * Profile interests, for the native app.
 *
 * The web app reaches the same behaviour through setProfileInterestsAction;
 * both call lib/profile/interests-service.ts, so the closed-taxonomy check and
 * the add-before-remove ordering cannot differ between the two platforms.
 *
 * Authentication is the only difference: a Server Action reads the session
 * cookie, this resolves a Bearer token through resolveApiUser. The service is
 * handed the userId either way.
 */

export function OPTIONS(request: Request) {
  return preflightResponse(request);
}

/**
 * Replace the whole selection.
 *
 * PUT rather than POST because the body is the complete set, not an addition:
 * the service diffs it against what is stored and applies only the difference.
 */
export async function PUT(request: Request) {
  const auth = await resolveApiUser(request);
  if (!auth) {
    return withCors(NextResponse.json({ error: "Authentication required." }, { status: 401 }), request);
  }

  const body = await request.json().catch(() => null);
  const result = await setProfileInterests(createSupabaseAdminClient(), auth.user.id, body);
  // A refusal here is a validation problem — a value outside the taxonomy, or
  // too many of them — not a malformed request.
  return withCors(NextResponse.json(result, { status: result.ok ? 200 : 400 }), request);
}
