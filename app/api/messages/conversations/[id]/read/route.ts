import { NextResponse } from "next/server";
import { resolveApiUser } from "@/lib/api/auth";
import { preflightResponse, withCors } from "@/lib/api/cors";
import { markConversationRead } from "@/lib/messaging/mobile";

export function OPTIONS(request: Request) {
  return preflightResponse(request);
}

// Mark a conversation read. Shared with markConversationReadAction.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await resolveApiUser(request);
  if (!auth) {
    return withCors(NextResponse.json({ error: "Authentication required." }, { status: 401 }), request);
  }

  const { id } = await params;
  const result = await markConversationRead(auth.user.id, id);
  return withCors(NextResponse.json(result, { status: result.ok ? 200 : 400 }), request);
}
