import { NextResponse } from "next/server";
import { resolveApiUser } from "@/lib/api/auth";
import { preflightResponse, withCors } from "@/lib/api/cors";
import { createMeetupRequest, dismissMeetupRequest, listMeetingPings } from "@/lib/meetups/service";

export function OPTIONS(request: Request) {
  return preflightResponse(request);
}

// The user's meeting pings (sent + received). Shared with loadMeetingPingsAction.
export async function GET(request: Request) {
  const auth = await resolveApiUser(request);
  if (!auth) {
    return withCors(NextResponse.json({ error: "Authentication required." }, { status: 401 }), request);
  }
  const pings = await listMeetingPings(auth.user.id);
  return withCors(NextResponse.json({ pings }), request);
}

// Send a new meeting ping. Shared with createMeetupRequestAction (Buddy Plus).
export async function POST(request: Request) {
  const auth = await resolveApiUser(request);
  if (!auth) {
    return withCors(NextResponse.json({ error: "Authentication required." }, { status: 401 }), request);
  }
  const input = await request.json().catch(() => null);
  const result = await createMeetupRequest(auth.user.id, input);
  return withCors(NextResponse.json(result, { status: result.ok ? 200 : 400 }), request);
}

// Dismiss (decline) a pending received ping. Shared with dismissMeetupRequestAction.
export async function DELETE(request: Request) {
  const auth = await resolveApiUser(request);
  if (!auth) {
    return withCors(NextResponse.json({ error: "Authentication required." }, { status: 401 }), request);
  }
  const body = (await request.json().catch(() => null)) as { id?: unknown } | null;
  const id = typeof body?.id === "string" ? body.id : "";
  const result = await dismissMeetupRequest(auth.user.id, id);
  return withCors(NextResponse.json(result, { status: result.ok ? 200 : 400 }), request);
}
