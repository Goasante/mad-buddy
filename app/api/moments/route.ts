import { NextResponse } from "next/server";
import { resolveApiUser } from "@/lib/api/auth";
import { preflightResponse, withCors } from "@/lib/api/cors";
import { buildMomentFeed, buildOpenMomentFeed } from "@/lib/content/service";
import { createTextMoment, deleteMoment } from "@/lib/content/moment-mobile";
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

  const open = new URL(request.url).searchParams.get("feed") === "open";
  const admin = createSupabaseAdminClient();
  const moments = open
    ? await buildOpenMomentFeed(admin, auth.user.id)
    : await buildMomentFeed(admin, auth.user.id);
  return withCors(NextResponse.json({ moments }), request);
}

// Share a text Moment. Public audience requests use the same flag, Pro,
// confirmation, expiry, and safety checks as the web action.
export async function POST(request: Request) {
  const auth = await resolveApiUser(request);
  if (!auth) {
    return withCors(NextResponse.json({ error: "Authentication required." }, { status: 401 }), request);
  }

  const input = await request.json().catch(() => null);
  const result = await createTextMoment(auth.user.id, input);
  return withCors(NextResponse.json(result, { status: result.ok ? 200 : 400 }), request);
}

// Delete one of the author's own Moments. Shared with deleteMomentAction.
export async function DELETE(request: Request) {
  const auth = await resolveApiUser(request);
  if (!auth) {
    return withCors(NextResponse.json({ error: "Authentication required." }, { status: 401 }), request);
  }

  const body = (await request.json().catch(() => null)) as { id?: unknown } | null;
  const id = typeof body?.id === "string" ? body.id : "";
  const result = await deleteMoment(auth.user.id, id);
  return withCors(NextResponse.json(result, { status: result.ok ? 200 : 400 }), request);
}
