import { NextResponse } from "next/server";
import { resolveApiUser } from "@/lib/api/auth";
import { preflightResponse, withCors } from "@/lib/api/cors";
import { setEventRsvp } from "@/lib/events/mobile";

export function OPTIONS(request: Request) {
  return preflightResponse(request);
}

/**
 * Mobile RSVP.
 *
 * Delegates to setEventRsvp -- the same authority the web action uses -- so
 * visibility, blocks, host-cannot-RSVP, cancelled/past refusal and rate limits
 * are decided in one place. A transport that re-implemented those rules is a
 * transport that will eventually disagree with the other one.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await resolveApiUser(request);
  if (!auth) {
    return withCors(NextResponse.json({ error: "Authentication required." }, { status: 401 }), request);
  }

  const { id } = await params;
  const body = (await request.json().catch(() => null)) as { status?: unknown } | null;
  const result = await setEventRsvp(auth.user.id, id, body?.status);
  return withCors(NextResponse.json(result, { status: result.ok ? 200 : 400 }), request);
}
