import { NextResponse } from "next/server";
import { z } from "zod";
import { resolveApiUser } from "@/lib/api/auth";
import { preflightResponse, withCors } from "@/lib/api/cors";
import { openDirectConversation } from "@/lib/messaging/mobile";

const bodySchema = z.object({ recipientId: z.string().uuid() });

export function OPTIONS(request: Request) {
  return preflightResponse(request);
}

// Open (or create) a direct conversation with a Muddy. Shared with
// openDirectConversationAction; eligibility is re-checked server-side.
export async function POST(request: Request) {
  const auth = await resolveApiUser(request);
  if (!auth) {
    return withCors(NextResponse.json({ error: "Authentication required." }, { status: 401 }), request);
  }

  const body = bodySchema.safeParse(await request.json().catch(() => null));
  if (!body.success) {
    return withCors(NextResponse.json({ error: "Muddy not found." }, { status: 400 }), request);
  }

  const result = await openDirectConversation(auth.user.id, body.data.recipientId);
  return withCors(NextResponse.json(result, { status: result.ok ? 200 : 400 }), request);
}
