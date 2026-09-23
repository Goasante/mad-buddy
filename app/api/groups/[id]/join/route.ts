import { NextResponse } from "next/server";
import { resolveApiUser } from "@/lib/api/auth";
import { preflightResponse, withCors } from "@/lib/api/cors";

export function OPTIONS(request: Request) {
  return preflightResponse(request);
}

export async function POST(request: Request) {
  const auth = await resolveApiUser(request);
  if (!auth) {
    return withCors(NextResponse.json({ error: "Authentication required." }, { status: 401 }), request);
  }
  return withCors(
    NextResponse.json(
      { ok: false, message: "Groups are private and invitation-only. Open the invitation in Messages." },
      { status: 410 }
    ),
    request
  );
}
