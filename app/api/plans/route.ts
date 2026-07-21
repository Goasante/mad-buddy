import { NextResponse } from "next/server";
import { resolveApiUser } from "@/lib/api/auth";
import { preflightResponse, withCors } from "@/lib/api/cors";
import { createPlan } from "@/lib/plans/service";

export function OPTIONS(request: Request) {
  return preflightResponse(request);
}

// Create a plan. Shared with `createPlanAction`. (The plans list is read
// directly under RLS by the client, so no GET is needed here.)
export async function POST(request: Request) {
  const auth = await resolveApiUser(request);
  if (!auth) {
    return withCors(NextResponse.json({ error: "Authentication required." }, { status: 401 }), request);
  }

  const input = await request.json().catch(() => null);
  const result = await createPlan(auth.user.id, input);

  return withCors(NextResponse.json(result, { status: result.ok ? 200 : 400 }), request);
}
