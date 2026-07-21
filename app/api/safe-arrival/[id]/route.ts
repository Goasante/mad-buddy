import { NextResponse } from "next/server";
import { z } from "zod";
import { resolveApiUser } from "@/lib/api/auth";
import { preflightResponse, withCors } from "@/lib/api/cors";
import { cancelSafeArrival, confirmSafeArrival } from "@/lib/safety/safe-arrival-mobile";

const actionSchema = z.object({ action: z.enum(["confirm", "cancel"]) });

export function OPTIONS(request: Request) {
  return preflightResponse(request);
}

// Confirm arrival or cancel a journey (traveller only, enforced in the service).
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await resolveApiUser(request);
  if (!auth) {
    return withCors(NextResponse.json({ error: "Authentication required." }, { status: 401 }), request);
  }
  const body = actionSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) {
    return withCors(NextResponse.json({ error: "Choose confirm or cancel." }, { status: 400 }), request);
  }
  const { id } = await params;
  const result =
    body.data.action === "confirm"
      ? await confirmSafeArrival(auth.user.id, id)
      : await cancelSafeArrival(auth.user.id, id);
  return withCors(NextResponse.json(result, { status: result.ok ? 200 : 400 }), request);
}
