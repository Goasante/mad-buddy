import { NextResponse } from "next/server";
import { resolveApiUser } from "@/lib/api/auth";
import { preflightResponse, withCors } from "@/lib/api/cors";
import { listConversations } from "@/lib/messaging/mobile";

export function OPTIONS(request: Request) {
  return preflightResponse(request);
}

// The user's conversations. Shared with getConversationsAction.
export async function GET(request: Request) {
  // FORENSICS ONLY (perf/profile-forensics): Server-Timing for the medium-route
  // control curve. No data change.
  const t0 = performance.now();
  const auth = await resolveApiUser(request);
  const authMs = performance.now() - t0;
  if (!auth) {
    return withCors(NextResponse.json({ error: "Authentication required." }, { status: 401 }), request);
  }

  const tWork = performance.now();
  const conversations = await listConversations(auth.user.id);
  const workMs = performance.now() - tWork;
  const timing = `auth;dur=${authMs.toFixed(1)}, work;dur=${workMs.toFixed(1)}, total;dur=${(performance.now() - t0).toFixed(1)}`;
  return withCors(NextResponse.json({ conversations }, { headers: { "Server-Timing": timing } }), request);
}
