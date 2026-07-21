import { NextResponse } from "next/server";
import { resolveApiUser } from "@/lib/api/auth";
import { preflightResponse, withCors } from "@/lib/api/cors";
import { updateProfile } from "@/lib/profile/service";

export function OPTIONS(request: Request) {
  return preflightResponse(request);
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
