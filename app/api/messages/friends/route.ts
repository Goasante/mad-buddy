import { NextResponse } from "next/server";
import { resolveApiUser } from "@/lib/api/auth";
import { preflightResponse, withCors } from "@/lib/api/cors";
import { listMessageableFriends } from "@/lib/messaging/mobile";

export function OPTIONS(request: Request) {
  return preflightResponse(request);
}

// Friends the "new message" picker can offer. Shared with
// getMessageableFriendsAction (discovery only; open re-validates eligibility).
export async function GET(request: Request) {
  const auth = await resolveApiUser(request);
  if (!auth) {
    return withCors(NextResponse.json({ error: "Authentication required." }, { status: 401 }), request);
  }

  const friends = await listMessageableFriends(auth.user.id);
  return withCors(NextResponse.json({ friends }), request);
}
