import { NextResponse } from "next/server";
import { z } from "zod";
import { resolveApiUser } from "@/lib/api/auth";
import { preflightResponse, withCors } from "@/lib/api/cors";
import { rsvp } from "@/lib/plans/service";

const bodySchema = z.object({ status: z.string() });

export function OPTIONS(request: Request) {
  return preflightResponse(request);
}

// RSVP to a plan. Shared with `rsvpAction`. The plan id comes from the path;
// the service validates it and enforces participation + capacity.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await resolveApiUser(request);
  if (!auth) {
    return withCors(NextResponse.json({ error: "Authentication required." }, { status: 401 }), request);
  }

  const body = bodySchema.safeParse(await request.json().catch(() => null));
  if (!body.success) {
    return withCors(
      NextResponse.json({ error: "Choose Going, Maybe, or Can't make it." }, { status: 400 }),
      request
    );
  }

  const { id } = await params;
  const result = await rsvp(auth.user.id, id, body.data.status);

  return withCors(NextResponse.json(result, { status: result.ok ? 200 : 400 }), request);
}
