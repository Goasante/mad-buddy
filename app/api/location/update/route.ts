import { NextResponse } from "next/server";
import { z } from "zod";
import { createRequestId, errorType, logBackendEvent } from "@/lib/observability/logger";
import { locationUpdateRequestSchema, confidenceFromAccuracy } from "@/lib/proximity/backend";
import { consumeRateLimit, rateLimitMessage } from "@/lib/security/rate-limit";
import { guardFeature } from "@/lib/admin/enforcement";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSupabaseBrowserEnv, getSupabaseServerEnv } from "@/lib/supabase/env";
import { resolveApiUser } from "@/lib/api/auth";
import { preflightResponse, withCors } from "@/lib/api/cors";

const responseSchema = z.object({
  received: z.boolean(),
  expiresInSeconds: z.number().int().positive(),
  confidence: z.enum(["high", "medium", "low"])
});

// CORS preflight for the native app; a no-op for same-origin web.
export function OPTIONS(request: Request) {
  return preflightResponse(request);
}

export async function POST(request: Request) {
  const requestId = createRequestId();
  const startedAt = Date.now();
  const route = "/api/location/update";
  const env = getSupabaseBrowserEnv();

  if (!env.url || !env.anonKey) {
    logBackendEvent("warn", {
      requestId,
      route,
      statusCode: 503,
      latencyMs: Date.now() - startedAt
    });
    return withCors(NextResponse.json({ error: "Supabase is not configured yet." }, { status: 503 }), request);
  }

  const parsedBody = locationUpdateRequestSchema.safeParse(await request.json().catch(() => null));

  if (!parsedBody.success) {
    logBackendEvent("warn", {
      requestId,
      route,
      statusCode: 400,
      latencyMs: Date.now() - startedAt
    });
    return withCors(NextResponse.json({ error: "Invalid location update." }, { status: 400 }), request);
  }

  // Web cookie session or mobile bearer token — same user, same RLS.
  const auth = await resolveApiUser(request);

  if (!auth) {
    logBackendEvent("warn", {
      requestId,
      route,
      statusCode: 401,
      latencyMs: Date.now() - startedAt
    });
    return withCors(NextResponse.json({ error: "Authentication required." }, { status: 401 }), request);
  }
  const { user } = auth;

  const rateLimit = await consumeRateLimit({
    action: "location.update",
    userId: user.id,
    requestId
  });

  if (!rateLimit.allowed) {
    return withCors(NextResponse.json({ error: rateLimitMessage(rateLimit.resetAt) }, { status: 429 }), request);
  }

  // Emergency kill switch (batch 13 §46, §47). During a suspected location
  // exposure we stop ingesting location entirely, this is the switch that
  // has to actually work, so it is checked before anything is written.
  const serverEnv = getSupabaseServerEnv();
  if (serverEnv.url && serverEnv.serviceRoleKey) {
    const guard = await guardFeature(createSupabaseAdminClient(), "location_collection");
    if (!guard.allowed) {
      logBackendEvent("warn", { requestId, route, statusCode: 503, latencyMs: Date.now() - startedAt });
      return withCors(NextResponse.json({ error: guard.message }, { status: 503 }), request);
    }
  }

  const confidence = confidenceFromAccuracy(parsedBody.data.accuracy);
  // Only this authenticated, rate-limited server boundary may persist raw
  // coordinates. Authenticated browser roles have no direct table-write grant.
  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("user_locations").upsert(
    {
      user_id: user.id,
      latitude: parsedBody.data.latitude,
      longitude: parsedBody.data.longitude,
      accuracy: parsedBody.data.accuracy,
      confidence,
      last_updated: new Date().toISOString()
    },
    { onConflict: "user_id" }
  );

  if (error) {
    logBackendEvent("warn", {
      requestId,
      route,
      statusCode: 500,
      latencyMs: Date.now() - startedAt,
      userId: user.id,
      errorType: errorType(error)
    });
    return withCors(
      NextResponse.json({ error: "Could not update your private proximity signal." }, { status: 500 }),
      request
    );
  }

  const response = responseSchema.parse({
    received: true,
    expiresInSeconds: 900,
    confidence
  });

  logBackendEvent("info", {
    requestId,
    route,
    statusCode: 200,
    latencyMs: Date.now() - startedAt,
    userId: user.id
  });

  return withCors(NextResponse.json(response), request);
}
