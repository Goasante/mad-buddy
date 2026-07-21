import { NextResponse } from "next/server";
import { resolveApiUser } from "@/lib/api/auth";
import { preflightResponse, withCors } from "@/lib/api/cors";
import { updateVisibilityStatus } from "@/lib/settings/service";

export function OPTIONS(request: Request) {
  return preflightResponse(request);
}

// Update glow visibility. Shared with `updateVisibilityStatusAction`; runs
// under the caller's RLS-scoped client so the profile row is self-owned.
export async function POST(request: Request) {
  const auth = await resolveApiUser(request);
  if (!auth) {
    return withCors(NextResponse.json({ error: "Authentication required." }, { status: 401 }), request);
  }

  const input = await request.json().catch(() => null);
  const result = await updateVisibilityStatus(auth.supabase, auth.user.id, input);

  return withCors(NextResponse.json(result, { status: result.ok ? 200 : 400 }), request);
}
