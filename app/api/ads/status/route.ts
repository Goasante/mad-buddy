import { NextResponse } from "next/server";

import { resolveApiUser } from "@/lib/api/auth";
import { preflightResponse, withCors } from "@/lib/api/cors";
import { resolveRuntimeAdStatus } from "@/lib/ads/server-status";

export const dynamic = "force-dynamic";

export function OPTIONS(request: Request) {
  return preflightResponse(request);
}

export async function GET(request: Request) {
  const auth = await resolveApiUser(request);
  if (!auth) {
    return withCors(
      NextResponse.json(
        { error: "Authentication required." },
        { status: 401, headers: noStoreHeaders() }
      ),
      request
    );
  }

  return withCors(
    NextResponse.json(await resolveRuntimeAdStatus(auth.user.id), {
      status: 200,
      headers: noStoreHeaders()
    }),
    request
  );
}

function noStoreHeaders() {
  return {
    "Cache-Control": "private, no-store, max-age=0",
    Pragma: "no-cache"
  };
}
