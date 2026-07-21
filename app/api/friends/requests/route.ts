import { NextResponse } from "next/server";
import { resolveApiUser } from "@/lib/api/auth";
import { preflightResponse, withCors } from "@/lib/api/cors";
import { listIncomingRequests } from "@/lib/friends/service";

export function OPTIONS(request: Request) {
  return preflightResponse(request);
}

// Incoming pending Muddy requests (with sender profile), newest first. The web
// resolves this in a server component; the native app has no server render, so
// it reads this endpoint. Same service-role resolution either way.
export async function GET(request: Request) {
  const auth = await resolveApiUser(request);
  if (!auth) {
    return withCors(NextResponse.json({ error: "Authentication required." }, { status: 401 }), request);
  }

  const result = await listIncomingRequests(auth.user.id);
  return withCors(NextResponse.json(result, { status: result.ok ? 200 : 400 }), request);
}
