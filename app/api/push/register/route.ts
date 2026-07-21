import { NextResponse } from "next/server";
import { z } from "zod";
import { resolveApiUser } from "@/lib/api/auth";
import { preflightResponse, withCors } from "@/lib/api/cors";
import { registerDeviceToken, removeDeviceToken } from "@/lib/notifications/device-tokens";

const deleteSchema = z.object({ token: z.string().min(1) });

export function OPTIONS(request: Request) {
  return preflightResponse(request);
}

// Store a native (FCM/APNs) device token for the signed-in user. Mobile-only;
// the web app has no native tokens.
export async function POST(request: Request) {
  const auth = await resolveApiUser(request);
  if (!auth) {
    return withCors(NextResponse.json({ error: "Authentication required." }, { status: 401 }), request);
  }

  const input = await request.json().catch(() => null);
  const result = await registerDeviceToken(auth.user.id, input);

  return withCors(NextResponse.json(result, { status: result.ok ? 200 : 400 }), request);
}

// Remove a device token (e.g. on sign-out). Scoped to the owner in the service.
export async function DELETE(request: Request) {
  const auth = await resolveApiUser(request);
  if (!auth) {
    return withCors(NextResponse.json({ error: "Authentication required." }, { status: 401 }), request);
  }

  const body = deleteSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) {
    return withCors(NextResponse.json({ error: "No token provided." }, { status: 400 }), request);
  }

  const result = await removeDeviceToken(auth.user.id, body.data.token);
  return withCors(NextResponse.json(result, { status: result.ok ? 200 : 400 }), request);
}
