import { NextResponse } from "next/server";
import { resolveApiUser } from "@/lib/api/auth";
import { preflightResponse, withCors } from "@/lib/api/cors";
import { checkInToEvent, checkOutEvent } from "@/lib/events/mobile";

export function OPTIONS(request: Request) {
  return preflightResponse(request);
}

// Manual check-in to an event (mobile). Server enforces the check-in window.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await resolveApiUser(request);
  if (!auth) {
    return withCors(NextResponse.json({ error: "Authentication required." }, { status: 401 }), request);
  }
  const { id } = await params;
  const result = await checkInToEvent(auth.user.id, id);
  return withCors(NextResponse.json(result, { status: result.ok ? 200 : 400 }), request);
}

// Check out. The body carries the check-in id (from the event list).
export async function DELETE(request: Request) {
  const auth = await resolveApiUser(request);
  if (!auth) {
    return withCors(NextResponse.json({ error: "Authentication required." }, { status: 401 }), request);
  }
  const body = (await request.json().catch(() => null)) as { checkInId?: string } | null;
  if (!body?.checkInId) {
    return withCors(NextResponse.json({ error: "Missing check-in id." }, { status: 400 }), request);
  }
  const result = await checkOutEvent(auth.user.id, body.checkInId);
  return withCors(NextResponse.json(result, { status: result.ok ? 200 : 400 }), request);
}
