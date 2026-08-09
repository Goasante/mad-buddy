import { NextResponse } from "next/server";
import { resolveApiUser } from "@/lib/api/auth";
import { preflightResponse, withCors } from "@/lib/api/cors";
import { getUnreadMessageCount } from "@/lib/messaging/mobile";

export function OPTIONS(request: Request) {
  return preflightResponse(request);
}

export async function GET(request: Request) {
  const auth = await resolveApiUser(request);
  if (!auth) {
    return withCors(NextResponse.json({ error: "Authentication required." }, { status: 401 }), request);
  }

  const unreadCount = await getUnreadMessageCount(auth.user.id);
  return withCors(
    NextResponse.json({ unreadCount }, { headers: { "Cache-Control": "private, no-store" } }),
    request
  );
}
