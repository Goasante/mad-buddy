import { NextResponse } from "next/server";
import { resolveApiUser } from "@/lib/api/auth";
import { preflightResponse, withCors } from "@/lib/api/cors";
import { discoverSocializePeople } from "@/lib/social/socialize-mobile";

export function OPTIONS(request: Request) {
  return preflightResponse(request);
}

// People currently using Socialize near you (privacy-safe tiers only). Shared
// with discoverSocializePeopleAction. Waving = a friend request (/api/friends/request).
export async function GET(request: Request) {
  const auth = await resolveApiUser(request);
  if (!auth) {
    return withCors(NextResponse.json({ error: "Authentication required." }, { status: 401 }), request);
  }
  const people = await discoverSocializePeople(auth.user.id);
  return withCors(NextResponse.json({ people }), request);
}
