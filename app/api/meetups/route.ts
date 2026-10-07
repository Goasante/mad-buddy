import { NextResponse } from "next/server";
import { resolveApiUser } from "@/lib/api/auth";
import { preflightResponse, withCors } from "@/lib/api/cors";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { loadMeetups, loadMeetupMuddies } from "@/lib/meetups/arrangements";
import { saveMeetupCommand } from "@/lib/meetups/commands";
import { guardAction } from "@/lib/admin/enforcement";
import { optionalFeatureEnabled, FEATURE_LOCK_MESSAGE } from "@/lib/features/availability-server";
import { loadMeetupDiscoveryHub } from "@/lib/meetups/discovery-service";

function privateJson(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
}

export function OPTIONS(request: Request) { return preflightResponse(request); }
export async function GET(request: Request) {
  const auth = await resolveApiUser(request);
  if (!auth) return withCors(NextResponse.json({ error: "Authentication required." }, { status: 401 }), request);
  if (!(await optionalFeatureEnabled("safe_arrival"))) return withCors(NextResponse.json({ error: FEATURE_LOCK_MESSAGE }, { status: 403 }), request);
  const admin = createSupabaseAdminClient();
  const guard = await guardAction(admin, { userId: auth.user.id, surface: "plans" });
  if (!guard.allowed) return withCors(NextResponse.json({ error: guard.message }, { status: 403 }), request);
  const [meetups, muddies, discoveryHub] = await Promise.all([
    loadMeetups(admin, auth.user.id),
    loadMeetupMuddies(admin, auth.user.id),
    loadMeetupDiscoveryHub(auth.user.id)
  ]);
  return withCors(privateJson({ meetups, muddies, discoveryHub }), request);
}
async function mutate(request: Request, create: boolean) {
  const auth = await resolveApiUser(request);
  if (!auth) return withCors(NextResponse.json({ error: "Authentication required." }, { status: 401 }), request);
  const input = await request.json().catch(() => null);
  const result = await saveMeetupCommand(auth.user.id, input, create);
  return withCors(NextResponse.json(result, { status: result.ok ? 200 : 400 }), request);
}
export async function POST(request: Request) { return mutate(request, true); }
export async function PATCH(request: Request) { return mutate(request, false); }
