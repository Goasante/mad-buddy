import { NextResponse } from "next/server";
import { resolveApiUser } from "@/lib/api/auth";
import { preflightResponse, withCors } from "@/lib/api/cors";
import { searchUsers } from "@/lib/friends/service";

// CORS preflight for the native app; a no-op for same-origin web.
export function OPTIONS(request: Request) {
  return preflightResponse(request);
}

// Search public profiles by username or name. Shared with the web Server
// Action `searchUsersAction` — same logic, same RLS-safe service call.
export async function GET(request: Request) {
  const auth = await resolveApiUser(request);
  if (!auth) {
    return withCors(NextResponse.json({ error: "Authentication required." }, { status: 401 }), request);
  }

  const query = new URL(request.url).searchParams.get("q") ?? "";
  const result = await searchUsers(auth.user.id, query);

  return withCors(NextResponse.json(result, { status: result.ok ? 200 : 400 }), request);
}
