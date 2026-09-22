import { NextResponse } from "next/server";
import { z } from "zod";
import { resolveApiUser } from "@/lib/api/auth";
import { preflightResponse, withCors } from "@/lib/api/cors";
import { sendFriendRequest } from "@/lib/friends/service";
import { sendLinkrInterest } from "@/lib/social/linkr-interest";

const bodySchema = z.object({
  targetUserId: z.string().uuid(),
  source: z.enum(["friend", "socialize"]).default("friend")
});

export function OPTIONS(request: Request) {
  return preflightResponse(request);
}

// Send a Muddy request or record a private Linkr choice. The sender is the
// verified caller, never the body. Linkr uses the caller-scoped client so a
// reciprocal choice can go through the canonical accept_friend_request RPC.
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

  const result =
    body.data.source === "socialize"
      ? await sendLinkrInterest(auth.supabase, auth.user.id, body.data.targetUserId)
      : await sendFriendRequest(auth.user.id, body.data.targetUserId, body.data.source);

  return withCors(NextResponse.json(result, { status: result.ok ? 200 : 400 }), request);
}
