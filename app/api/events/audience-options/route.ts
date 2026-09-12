import { NextResponse } from "next/server";
import { resolveApiUser } from "@/lib/api/auth";
import { preflightResponse, withCors } from "@/lib/api/cors";
import { listCommunityOptions, listInviteeOptions } from "@/lib/events/audience-options";

export function OPTIONS(request: Request) {
  return preflightResponse(request);
}

// Who this account may invite, and which communities it may post to. Shared
// with getAudienceOptionsAction -- same two service calls, same authority.
//
// An unauthenticated caller gets empty lists rather than a 401, matching the
// action: the audience picker renders with nothing to choose rather than
// erroring, and an empty list tells a prober nothing.
export async function GET(request: Request) {
  const auth = await resolveApiUser(request);
  if (!auth) {
    return withCors(NextResponse.json({ invitees: [], communities: [] }), request);
  }
  const [invitees, communities] = await Promise.all([
    listInviteeOptions(auth.user.id),
    listCommunityOptions(auth.user.id)
  ]);
  return withCors(NextResponse.json({ invitees, communities }), request);
}
