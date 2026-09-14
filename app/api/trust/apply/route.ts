import { NextResponse } from "next/server";
import { resolveApiUser } from "@/lib/api/auth";
import { preflightResponse, withCors } from "@/lib/api/cors";
import { applyForTrustedMember, getTrustedMemberStanding } from "@/lib/trust/application-service";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * Trusted Member applications, for the native app.
 *
 * The web app reaches the same behaviour through the Server Actions in
 * app/(app)/trusted-member-actions.ts; both call
 * lib/trust/application-service.ts, so the rate limit and — more importantly —
 * the server-side eligibility recomputation are one implementation rather than
 * two.
 *
 * That recomputation is the point: a page rendered an hour ago may have shown
 * an Apply button that is no longer honest, so the answer is never taken from
 * the client.
 */

export function OPTIONS(request: Request) {
  return preflightResponse(request);
}

/**
 * The caller's own standing.
 *
 * Read-only and only ever about themselves — there is no way to ask about
 * anyone else, because the userId comes from the proven session rather than
 * from the request.
 */
export async function GET(request: Request) {
  const auth = await resolveApiUser(request);
  if (!auth) {
    return withCors(NextResponse.json({ error: "Authentication required." }, { status: 401 }), request);
  }

  const standing = await getTrustedMemberStanding(createSupabaseAdminClient(), auth.user.id);
  return withCors(NextResponse.json(standing), request);
}

/** Submit an application. Upserts, so re-applying updates rather than queueing twice. */
export async function POST(request: Request) {
  const auth = await resolveApiUser(request);
  if (!auth) {
    return withCors(NextResponse.json({ error: "Authentication required." }, { status: 401 }), request);
  }

  const body = await request.json().catch(() => null);
  const result = await applyForTrustedMember(createSupabaseAdminClient(), auth.user.id, body);
  // A refusal here is an eligibility or rate-limit decision, not a malformed
  // request: the note was fine, the person just cannot apply right now.
  return withCors(NextResponse.json(result, { status: result.ok ? 200 : 400 }), request);
}
