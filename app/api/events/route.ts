import { NextResponse } from "next/server";
import { resolveApiUser } from "@/lib/api/auth";
import { preflightResponse, withCors } from "@/lib/api/cors";
import { createEvent, listEvents } from "@/lib/events/mobile";

export function OPTIONS(request: Request) {
  return preflightResponse(request);
}

// Upcoming/live community events + anything you host. Shared with getEventsAction.
export async function GET(request: Request) {
  const auth = await resolveApiUser(request);
  if (!auth) {
    return withCors(NextResponse.json({ error: "Authentication required." }, { status: 401 }), request);
  }
  const events = await listEvents(auth.user.id);
  return withCors(NextResponse.json({ events }), request);
}

// Create a community event. Shared with createEventAction.
export async function POST(request: Request) {
  const auth = await resolveApiUser(request);
  if (!auth) {
    return withCors(NextResponse.json({ error: "Authentication required." }, { status: 401 }), request);
  }
  const input = await request.json().catch(() => null);
  const result = await createEvent(auth.user.id, input);
  return withCors(NextResponse.json(result, { status: result.ok ? 200 : 400 }), request);
}
