import { NextResponse } from "next/server";
import { resolveApiUser } from "@/lib/api/auth";
import { preflightResponse, withCors } from "@/lib/api/cors";
import {
  activateSocialize,
  deactivateSocialize,
  getCurrentSocialize,
  updateSocialize
} from "@/lib/social/socialize-mobile";

export function OPTIONS(request: Request) {
  return preflightResponse(request);
}

// Current Socialize session (or null). Shared with getCurrentSocializeAction.
export async function GET(request: Request) {
  const auth = await resolveApiUser(request);
  if (!auth) {
    return withCors(NextResponse.json({ error: "Authentication required." }, { status: 401 }), request);
  }
  const session = await getCurrentSocialize(auth.user.id);
  return withCors(NextResponse.json({ session }), request);
}

// Turn Socialize on. Shared with activateSocializeAction.
export async function POST(request: Request) {
  const auth = await resolveApiUser(request);
  if (!auth) {
    return withCors(NextResponse.json({ error: "Authentication required." }, { status: 401 }), request);
  }
  const input = await request.json().catch(() => null);
  const result = await activateSocialize(auth.user.id, input);
  return withCors(NextResponse.json(result, { status: result.ok ? 200 : 400 }), request);
}

// Update the active session. Shared with updateSocializeAction.
export async function PATCH(request: Request) {
  const auth = await resolveApiUser(request);
  if (!auth) {
    return withCors(NextResponse.json({ error: "Authentication required." }, { status: 401 }), request);
  }
  const input = await request.json().catch(() => null);
  const result = await updateSocialize(auth.user.id, input);
  return withCors(NextResponse.json(result, { status: result.ok ? 200 : 400 }), request);
}

// Turn Socialize off. Shared with deactivateSocializeAction.
export async function DELETE(request: Request) {
  const auth = await resolveApiUser(request);
  if (!auth) {
    return withCors(NextResponse.json({ error: "Authentication required." }, { status: 401 }), request);
  }
  const result = await deactivateSocialize(auth.user.id);
  return withCors(NextResponse.json(result, { status: result.ok ? 200 : 400 }), request);
}
