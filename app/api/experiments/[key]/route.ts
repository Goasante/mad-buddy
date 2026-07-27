import { NextResponse } from "next/server";
import { z } from "zod";
import { resolveApiUser } from "@/lib/api/auth";
import { preflightResponse, withCors } from "@/lib/api/cors";
import {
  recordExperimentExposure,
  requestExperimentPlatform,
  resolveExperiment
} from "@/lib/experiments/service";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const keySchema = z.string().regex(/^[a-z][a-z0-9_]{2,63}$/);

export function OPTIONS(request: Request) {
  return preflightResponse(request);
}

export async function GET(request: Request, context: { params: Promise<{ key: string }> }) {
  return handle(request, context, false);
}

export async function POST(request: Request, context: { params: Promise<{ key: string }> }) {
  return handle(request, context, true);
}

async function handle(
  request: Request,
  context: { params: Promise<{ key: string }> },
  expose: boolean
) {
  const auth = await resolveApiUser(request);
  if (!auth) return withCors(NextResponse.json({ error: "Authentication required." }, { status: 401 }), request);
  const parsed = keySchema.safeParse((await context.params).key);
  if (!parsed.success) return withCors(NextResponse.json({ error: "Invalid experiment key." }, { status: 400 }), request);

  try {
    const input = {
      experimentKey: parsed.data,
      userId: auth.user.id,
      platform: requestExperimentPlatform(request)
    };
    const result = expose
      ? await recordExperimentExposure(createSupabaseAdminClient(), input)
      : await resolveExperiment(createSupabaseAdminClient(), input);
    const response = NextResponse.json({
      experiment: result
        ? { variantKey: result.variantKey, variantName: result.variantName, isControl: result.isControl }
        : null
    });
    response.headers.set("Cache-Control", "private, no-store");
    return withCors(response, request);
  } catch {
    return withCors(
      NextResponse.json({ error: "The experiment assignment could not be resolved." }, { status: 503 }),
      request
    );
  }
}
