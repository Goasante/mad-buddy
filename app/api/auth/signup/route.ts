import { NextResponse } from "next/server";
import { preflightResponse, withCors } from "@/lib/api/cors";
import { registerConfirmedUser } from "@/lib/auth/bootstrap";

export function OPTIONS(request: Request) {
  return preflightResponse(request);
}

// Public sign-up for the native app. Creates a confirmed user and bootstraps
// its rows; the mobile client establishes its own Supabase session afterwards
// (signInWithPassword). Rate-limited by IP inside the service. Shares
// bootstrapNewUser with the web signUpAction so the two paths cannot drift.
export async function POST(request: Request) {
  const input = await request.json().catch(() => null);
  const result = await registerConfirmedUser(input);

  return withCors(NextResponse.json(result, { status: result.ok ? 200 : 400 }), request);
}
