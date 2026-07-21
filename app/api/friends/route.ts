import { NextResponse } from "next/server";
import { resolveApiUser } from "@/lib/api/auth";
import { preflightResponse, withCors } from "@/lib/api/cors";
import { listMuddies } from "@/lib/friends/service";

export function OPTIONS(request: Request) {
  return preflightResponse(request);
}

// The user's approved Muddies (friends list for the Muddies "All" tab).
export async function GET(request: Request) {
  const auth = await resolveApiUser(request);
  if (!auth) {
    return withCors(NextResponse.json({ error: "Authentication required." }, { status: 401 }), request);
  }
  const result = await listMuddies(auth.user.id);
  return withCors(NextResponse.json(result, { status: result.ok ? 200 : 400 }), request);
}
