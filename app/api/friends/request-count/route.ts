import { NextResponse } from "next/server";
import { resolveApiUser } from "@/lib/api/auth";
import { preflightResponse, withCors } from "@/lib/api/cors";
import { countIncomingRequests } from "@/lib/friends/service";

/**
 * Pending incoming Muddy requests, for the Muddies tab badge.
 *
 * Mirrors the unread-messages endpoint exactly, so the two badges cannot drift
 * apart in shape, caching or auth. Reuses countIncomingRequests -- the same
 * function behind the Add Muddy header control -- so the badge and the queue
 * can never disagree about how many requests are waiting.
 *
 * INCOMING ONLY. Requests the user has SENT are not pending anything on their
 * side, and counting them would show a badge nobody can clear.
 */

export function OPTIONS(request: Request) {
  return preflightResponse(request);
}

export async function GET(request: Request) {
  const auth = await resolveApiUser(request);
  if (!auth) {
    return withCors(NextResponse.json({ error: "Authentication required." }, { status: 401 }), request);
  }

  const requestCount = await countIncomingRequests(auth.user.id);
  return withCors(
    // Never cached: the count changes the moment a request is accepted or
    // declined, and a stale badge is worse than none.
    NextResponse.json({ requestCount }, { headers: { "Cache-Control": "private, no-store" } }),
    request
  );
}
