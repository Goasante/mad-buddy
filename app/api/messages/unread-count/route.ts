import { NextResponse } from "next/server";
import { resolveApiUser } from "@/lib/api/auth";
import { preflightResponse, withCors } from "@/lib/api/cors";
import { getUnreadMessageCount } from "@/lib/messaging/mobile";

export function OPTIONS(request: Request) {
  return preflightResponse(request);
}

export async function GET(request: Request) {
  // FORENSICS ONLY (perf/profile-forensics): Server-Timing so the cheap-route
  // control curve can separate auth cost from route work. No data change.
  const t0 = performance.now();
  const auth = await resolveApiUser(request);
  const authMs = performance.now() - t0;
  if (!auth) {
    return withCors(NextResponse.json({ error: "Authentication required." }, { status: 401 }), request);
  }

  const tWork = performance.now();
  const unreadCount = await getUnreadMessageCount(auth.user.id);
  const workMs = performance.now() - tWork;
  const timing = `auth;dur=${authMs.toFixed(1)}, work;dur=${workMs.toFixed(1)}, total;dur=${(performance.now() - t0).toFixed(1)}`;
  return withCors(
    NextResponse.json({ unreadCount }, { headers: { "Cache-Control": "private, no-store", "Server-Timing": timing } }),
    request
  );
}
