import { NextResponse } from "next/server";
import { z } from "zod";
import { resolveApiUser } from "@/lib/api/auth";
import { preflightResponse, withCors } from "@/lib/api/cors";
import { sendFriendRequest } from "@/lib/friends/service";

const bodySchema = z.object({ targetUserId: z.string().uuid() });

export function OPTIONS(request: Request) {
  return preflightResponse(request);
}

// Send a Muddy request. Shared with the web Server Action
// `sendFriendRequestAction`; the sender is the verified caller, never the body.
export async function POST(request: Request) {
  const auth = await resolveApiUser(request);
  if (!auth) {
    return withCors(NextResponse.json({ error: "Authentication required." }, { status: 401 }), request);
  }

  const body = bodySchema.safeParse(await request.json().catch(() => null));
  if (!body.success) {
    return withCors(
      NextResponse.json({ error: "Select a real searched user before sending a request." }, { status: 400 }),
      request
    );
  }

  const result = await sendFriendRequest(auth.user.id, body.data.targetUserId);

  return withCors(NextResponse.json(result, { status: result.ok ? 200 : 400 }), request);
}
