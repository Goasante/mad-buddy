import { NextResponse } from "next/server";
import { resolveApiUser } from "@/lib/api/auth";
import { preflightResponse, withCors } from "@/lib/api/cors";
import { respondToGroupInvitation } from "@/lib/groups/mobile";

export function OPTIONS(request: Request) {
  return preflightResponse(request);
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await resolveApiUser(request);
  if (!auth) {
    return withCors(NextResponse.json({ error: "Authentication required." }, { status: 401 }), request);
  }
  const body = await request.json().catch(() => null) as { accept?: unknown } | null;
  if (typeof body?.accept !== "boolean") {
    return withCors(NextResponse.json({ ok: false, message: "Choose whether to accept or decline." }, { status: 400 }), request);
  }
  const { id } = await params;
  const result = await respondToGroupInvitation(auth.user.id, id, body.accept);
  return withCors(NextResponse.json(result, { status: result.ok ? 200 : 400 }), request);
}
