import { NextResponse } from "next/server";
import { z } from "zod";
import { resolveApiUser } from "@/lib/api/auth";
import { preflightResponse, withCors } from "@/lib/api/cors";
import { loadConferenceFeed, loadConferenceTopic } from "@/lib/conference/server";
import { consumeRateLimit } from "@/lib/security/rate-limit";

const topicIdSchema = z.string().uuid();

export function OPTIONS(request: Request) {
  return preflightResponse(request);
}

export async function GET(request: Request) {
  const auth = await resolveApiUser(request);
  if (!auth) {
    return withCors(NextResponse.json({ error: "Authentication required." }, { status: 401 }), request);
  }

  const limit = await consumeRateLimit({ action: "conference.live", userId: auth.user.id });
  if (!limit.allowed) {
    return withCors(
      NextResponse.json({ error: "Conference is refreshing too quickly. Try again shortly." }, { status: 429 }),
      request
    );
  }

  const topicId = new URL(request.url).searchParams.get("topicId");
  const headers = { "Cache-Control": "no-store" };

  if (topicId) {
    const parsed = topicIdSchema.safeParse(topicId);
    if (!parsed.success) {
      return withCors(NextResponse.json({ error: "Topic not found." }, { status: 404, headers }), request);
    }

    const topic = await loadConferenceTopic(auth.user.id, parsed.data);
    if (!topic) {
      return withCors(
        NextResponse.json({ stale: true, error: "Topic no longer available." }, { status: 404, headers }),
        request
      );
    }

    return withCors(NextResponse.json({ topic }, { headers }), request);
  }

  const feed = await loadConferenceFeed(auth.user.id);
  return withCors(NextResponse.json({ feed }, { headers }), request);
}
