import { NextResponse } from "next/server";
import { z } from "zod";
import { resolveApiUser } from "@/lib/api/auth";
import { preflightResponse, withCors } from "@/lib/api/cors";
import { sendWave } from "@/lib/social/waves-mobile";

const bodySchema = z.object({ targetUserId: z.string().uuid() });

export function OPTIONS(request: Request) {
  return preflightResponse(request);
}

// Wave at an approved Muddy (from the Muddies Active-now card).
export async function POST(request: Request) {
  const auth = await resolveApiUser(request);
  if (!auth) {
    return withCors(NextResponse.json({ error: "Authentication required." }, { status: 401 }), request);
  }
  const body = bodySchema.safeParse(await request.json().catch(() => null));
  if (!body.success) {
    return withCors(NextResponse.json({ error: "Choose a Muddy before waving." }, { status: 400 }), request);
  }
  const result = await sendWave(auth.user.id, body.data.targetUserId);
  return withCors(NextResponse.json(result, { status: result.ok ? 200 : 400 }), request);
}
