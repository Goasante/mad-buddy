import { NextResponse } from "next/server";
import { z } from "zod";
import { resolveApiUser } from "@/lib/api/auth";
import { preflightResponse, withCors } from "@/lib/api/cors";
import { acceptFriendRequest, updateFriendRequestStatus } from "@/lib/friends/service";

const bodySchema = z.object({
  requestId: z.string().uuid(),
  action: z.enum(["accept", "decline", "cancel"])
});

export function OPTIONS(request: Request) {
  return preflightResponse(request);
}

// Respond to a Muddy request. Shared with the web Server Actions
// `acceptFriendRequestAction` / `updateFriendRequestStatusAction`.
// Accept transitions state through the RLS-scoped client so only the receiver
// can accept; decline/cancel are guarded by participant column in the service.
export async function POST(request: Request) {
  const auth = await resolveApiUser(request);
  if (!auth) {
    return withCors(NextResponse.json({ error: "Authentication required." }, { status: 401 }), request);
  }

  const body = bodySchema.safeParse(await request.json().catch(() => null));
  if (!body.success) {
    return withCors(NextResponse.json({ error: "Select a real request first." }, { status: 400 }), request);
  }

  const { requestId, action } = body.data;

  const result =
    action === "accept"
      ? await acceptFriendRequest(auth.supabase, auth.user.id, requestId)
      : await updateFriendRequestStatus(
          auth.user.id,
          requestId,
          action === "decline" ? "declined" : "cancelled"
        );

  return withCors(NextResponse.json(result, { status: result.ok ? 200 : 400 }), request);
}
