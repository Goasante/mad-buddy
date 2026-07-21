import { NextResponse } from "next/server";
import { resolveApiUser } from "@/lib/api/auth";
import { preflightResponse, withCors } from "@/lib/api/cors";
import { getPublicProfile } from "@/lib/profile/public";

export function OPTIONS(request: Request) {
  return preflightResponse(request);
}

// A viewer-safe public profile for a tapped person. Blocked/missing -> 404.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await resolveApiUser(request);
  if (!auth) {
    return withCors(NextResponse.json({ error: "Authentication required." }, { status: 401 }), request);
  }
  const { id } = await params;
  const profile = await getPublicProfile(auth.user.id, id);
  if (!profile) {
    return withCors(NextResponse.json({ error: "Profile not available." }, { status: 404 }), request);
  }
  return withCors(NextResponse.json({ profile }), request);
}
