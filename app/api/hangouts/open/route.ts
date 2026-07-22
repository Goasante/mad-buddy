import { NextResponse } from "next/server";
import { resolveApiUser } from "@/lib/api/auth";
import { preflightResponse, withCors } from "@/lib/api/cors";
import { listOpenToPlans } from "@/lib/social/hangouts-mobile";

export function OPTIONS(request: Request) {
  return preflightResponse(request);
}

// Muddies open to plans right now (active Hangout Mode sessions), for the Home
// "Muddies open to plans" section.
export async function GET(request: Request) {
  const auth = await resolveApiUser(request);
  if (!auth) {
    return withCors(NextResponse.json({ error: "Authentication required." }, { status: 401 }), request);
  }
  const openToPlans = await listOpenToPlans(auth.user.id);
  return withCors(NextResponse.json({ openToPlans }), request);
}
