import { NextResponse } from "next/server";
import { resolveApiUser } from "@/lib/api/auth";
import { preflightResponse, withCors } from "@/lib/api/cors";
import { respondToMeetupRequest } from "@/lib/meetups/service";

export function OPTIONS(request: Request) {
  return preflightResponse(request);
}

// Reply to a received meeting ping. Shared with respondToMeetupRequestAction.
export async function POST(request: Request) {
  const auth = await resolveApiUser(request);
  if (!auth) {
    return withCors(NextResponse.json({ error: "Authentication required." }, { status: 401 }), request);
  }
  const input = await request.json().catch(() => null);
  const result = await respondToMeetupRequest(auth.user.id, input);
  return withCors(NextResponse.json(result, { status: result.ok ? 200 : 400 }), request);
}
