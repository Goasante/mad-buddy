import { NextResponse } from "next/server";
import { resolveApiUser } from "@/lib/api/auth";
import { preflightResponse, withCors } from "@/lib/api/cors";
import { listMessages } from "@/lib/messaging/mobile";

export function OPTIONS(request: Request) {
  return preflightResponse(request);
}

// Messages in a conversation. Shared with getMessagesAction; the service
// enforces conversation access, so a guessed id returns empty.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await resolveApiUser(request);
  if (!auth) {
    return withCors(NextResponse.json({ error: "Authentication required." }, { status: 401 }), request);
  }

  const { id } = await params;
  const messages = await listMessages(auth.user.id, id);
  return withCors(NextResponse.json({ messages }), request);
}
