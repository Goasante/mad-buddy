import { NextResponse } from "next/server";
import { resolveApiUser } from "@/lib/api/auth";
import { preflightResponse, withCors } from "@/lib/api/cors";
import { createSafeArrival, loadSafeArrival } from "@/lib/safety/safe-arrival-mobile";

export function OPTIONS(request: Request) {
  return preflightResponse(request);
}

// My journeys + journeys I watch + my trusted-contact options.
export async function GET(request: Request) {
  const auth = await resolveApiUser(request);
  if (!auth) {
    return withCors(NextResponse.json({ error: "Authentication required." }, { status: 401 }), request);
  }
  const data = await loadSafeArrival(auth.user.id);
  return withCors(NextResponse.json(data), request);
}

// Start a Safe Arrival journey.
export async function POST(request: Request) {
  const auth = await resolveApiUser(request);
  if (!auth) {
    return withCors(NextResponse.json({ error: "Authentication required." }, { status: 401 }), request);
  }
  const input = await request.json().catch(() => null);
  const result = await createSafeArrival(auth.user.id, input);
  return withCors(NextResponse.json(result, { status: result.ok ? 200 : 400 }), request);
}
