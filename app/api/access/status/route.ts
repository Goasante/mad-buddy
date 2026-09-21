import { NextResponse } from "next/server";

import { resolveAdEntitlementForUser } from "@/lib/access/ad-entitlement";
import { resolveApiUser } from "@/lib/api/auth";
import { preflightResponse, withCors } from "@/lib/api/cors";

export const dynamic = "force-dynamic";

export function OPTIONS(request: Request) {
  return preflightResponse(request);
}

/**
 * Minimal cross-platform Access projection.
 *
 * PWA may call this same-origin; Capacitor calls it with a bearer token. Both
 * paths resolve the SAME server-side entitlement and receive only what a
 * client needs to decide whether advertising is allowed.
 */
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

  const entitlement = await resolveAdEntitlementForUser(auth.user.id);
  return withCors(
    NextResponse.json(entitlement, { status: 200, headers: noStoreHeaders() }),
    request
  );
}

function noStoreHeaders() {
  return {
    "Cache-Control": "private, no-store, max-age=0",
    Pragma: "no-cache"
  };
}
