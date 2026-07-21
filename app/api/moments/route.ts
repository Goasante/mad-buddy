import { NextResponse } from "next/server";
import { resolveApiUser } from "@/lib/api/auth";
import { preflightResponse, withCors } from "@/lib/api/cors";
import { buildMomentFeed } from "@/lib/content/service";
import { createTextMoment } from "@/lib/content/moment-mobile";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export function OPTIONS(request: Request) {
  return preflightResponse(request);
}

// The viewer's authorized Moment feed. Shared with getMomentFeedAction via the
// same buildMomentFeed (authorization happens there).
export async function GET(request: Request) {
  const auth = await resolveApiUser(request);
  if (!auth) {
    return withCors(NextResponse.json({ error: "Authentication required." }, { status: 401 }), request);
  }

  const moments = await buildMomentFeed(createSupabaseAdminClient(), auth.user.id);
  return withCors(NextResponse.json({ moments }), request);
}

// Share a text Moment (mobile v1: text-only, all_muddies / nearby_muddies).
export async function POST(request: Request) {
  const auth = await resolveApiUser(request);
  if (!auth) {
    return withCors(NextResponse.json({ error: "Authentication required." }, { status: 401 }), request);
  }

  const input = await request.json().catch(() => null);
  const result = await createTextMoment(auth.user.id, input);
  return withCors(NextResponse.json(result, { status: result.ok ? 200 : 400 }), request);
}
