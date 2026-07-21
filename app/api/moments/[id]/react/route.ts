import { NextResponse } from "next/server";
import { z } from "zod";
import { resolveApiUser } from "@/lib/api/auth";
import { preflightResponse, withCors } from "@/lib/api/cors";
import { reactToMoment, removeMomentReaction } from "@/lib/content/moment-mobile";

const bodySchema = z.object({ reaction: z.string() });

export function OPTIONS(request: Request) {
  return preflightResponse(request);
}

// Add a reaction to a Moment. Server re-checks the viewer may see it.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await resolveApiUser(request);
  if (!auth) {
    return withCors(NextResponse.json({ error: "Authentication required." }, { status: 401 }), request);
  }

  const body = bodySchema.safeParse(await request.json().catch(() => null));
  if (!body.success) {
    return withCors(NextResponse.json({ error: "Choose a valid reaction." }, { status: 400 }), request);
  }

  const { id } = await params;
  const result = await reactToMoment(auth.user.id, id, body.data.reaction);
  return withCors(NextResponse.json(result, { status: result.ok ? 200 : 400 }), request);
}

// Remove your reaction.
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await resolveApiUser(request);
  if (!auth) {
    return withCors(NextResponse.json({ error: "Authentication required." }, { status: 401 }), request);
  }

  const { id } = await params;
  const result = await removeMomentReaction(auth.user.id, id);
  return withCors(NextResponse.json(result, { status: result.ok ? 200 : 400 }), request);
}
