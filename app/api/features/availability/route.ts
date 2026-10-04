import { NextResponse } from "next/server";
import { resolveApiUser } from "@/lib/api/auth";
import { withCors, preflightResponse } from "@/lib/api/cors";
import { loadFeatureAvailability } from "@/lib/features/availability-server";
export function OPTIONS(request: Request) { return preflightResponse(request); }
export async function GET(request: Request) {
  if (!(await resolveApiUser(request))) return withCors(NextResponse.json({ error: "Authentication required." }, { status: 401 }), request);
  return withCors(NextResponse.json(await loadFeatureAvailability(), { headers: { "Cache-Control": "no-store" } }), request);
}
