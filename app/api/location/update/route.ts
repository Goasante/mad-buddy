import { NextResponse } from "next/server";
import { z } from "zod";
import { createRequestId, errorType, logBackendEvent } from "@/lib/observability/logger";
import { locationUpdateRequestSchema, confidenceFromAccuracy } from "@/lib/proximity/backend";
import { consumeRateLimit, rateLimitMessage } from "@/lib/security/rate-limit";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabaseBrowserEnv } from "@/lib/supabase/env";

const responseSchema = z.object({
  received: z.boolean(),
  expiresInSeconds: z.number().int().positive(),
  confidence: z.enum(["high", "medium", "low"])
});

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
    return NextResponse.json(
      { error: "Supabase is not configured yet." },
      { status: 503 }
    );
  }

  const parsedBody = locationUpdateRequestSchema.safeParse(await request.json().catch(() => null));

  if (!parsedBody.success) {
    logBackendEvent("warn", {
      requestId,
      route,
      statusCode: 400,
      latencyMs: Date.now() - startedAt
    });
    return NextResponse.json({ error: "Invalid location update." }, { status: 400 });
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error: userError
  } = await supabase.auth.getUser();

  if (userError || !user) {
    logBackendEvent("warn", {
      requestId,
      route,
      statusCode: 401,
      latencyMs: Date.now() - startedAt,
      errorType: userError ? errorType(userError) : undefined
    });
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const rateLimit = await consumeRateLimit({
    action: "location.update",
    userId: user.id,
    requestId
  });

  if (!rateLimit.allowed) {
    return NextResponse.json({ error: rateLimitMessage(rateLimit.resetAt) }, { status: 429 });
  }

  const confidence = confidenceFromAccuracy(parsedBody.data.accuracy);
  const { error } = await supabase.from("user_locations").upsert(
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
    return NextResponse.json(
      { error: "Could not update your private proximity signal." },
      { status: 500 }
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

  return NextResponse.json(response);
}
