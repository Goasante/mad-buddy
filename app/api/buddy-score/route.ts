import { NextResponse } from "next/server";
import { resolveApiUser } from "@/lib/api/auth";
import { preflightResponse, withCors } from "@/lib/api/cors";
import { loadMyProgress } from "@/lib/progress/my-progress-service";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export function OPTIONS(request: Request) { return preflightResponse(request); }

export async function GET(request: Request) {
  const auth = await resolveApiUser(request);
  if (!auth) return withCors(NextResponse.json({ error: "Authentication required." }, { status: 401 }), request);
  const progress = await loadMyProgress(createSupabaseAdminClient(), auth.user.id);
  return withCors(NextResponse.json(progress), request);
}
