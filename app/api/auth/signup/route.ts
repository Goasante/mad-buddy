import { NextResponse } from "next/server";
import { preflightResponse, withCors } from "@/lib/api/cors";
import { registerUserWithEmailVerification } from "@/lib/auth/bootstrap";

export function OPTIONS(request: Request) {
  return preflightResponse(request);
}

// Public native signup uses the same verified-email policy as web signup.
export async function POST(request: Request) {
  const input = await request.json().catch(() => null);
  const result = await registerUserWithEmailVerification(input);

  return withCors(NextResponse.json(result, { status: result.ok ? 200 : 400 }), request);
}
