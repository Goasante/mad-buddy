import { NextResponse } from "next/server";
import { resolveApiUser } from "@/lib/api/auth";
import { preflightResponse, withCors } from "@/lib/api/cors";
import {
  createMeetupDiscovery,
  loadMeetupDiscoveryHub,
  updateMeetupDiscovery
} from "@/lib/meetups/discovery-service";

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
}

export function OPTIONS(request: Request) { return preflightResponse(request); }

export async function GET(request: Request) {
  const auth = await resolveApiUser(request);
  if (!auth) return withCors(json({ error: "Authentication required." }, 401), request);
  return withCors(json(await loadMeetupDiscoveryHub(auth.user.id)), request);
}

export async function POST(request: Request) {
  const auth = await resolveApiUser(request);
  if (!auth) return withCors(json({ error: "Authentication required." }, 401), request);
  const result = await createMeetupDiscovery(auth.user.id, await request.json().catch(() => null));
  return withCors(json(result, result.ok ? 200 : 400), request);
}

export async function PATCH(request: Request) {
  const auth = await resolveApiUser(request);
  if (!auth) return withCors(json({ error: "Authentication required." }, 401), request);
  const result = await updateMeetupDiscovery(auth.user.id, await request.json().catch(() => null));
  return withCors(json(result, result.ok ? 200 : 400), request);
}
