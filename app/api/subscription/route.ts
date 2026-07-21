import { NextResponse } from "next/server";
import { resolveApiUser } from "@/lib/api/auth";
import { preflightResponse, withCors } from "@/lib/api/cors";
import { getCurrentSubscriptionAccess } from "@/lib/premium/access";

export function OPTIONS(request: Request) {
  return preflightResponse(request);
}

// The viewer's current plan + status. Read-only: upgrades are managed on the
// web (App Store / Play in-app-purchase rules mean no external checkout here).
export async function GET(request: Request) {
  const auth = await resolveApiUser(request);
  if (!auth) {
    return withCors(NextResponse.json({ error: "Authentication required." }, { status: 401 }), request);
  }
  const access = await getCurrentSubscriptionAccess(auth.user.id);
  return withCors(NextResponse.json(access), request);
}
