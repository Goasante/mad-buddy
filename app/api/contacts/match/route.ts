import { NextResponse } from "next/server";
import { z } from "zod";

import { resolveApiUser } from "@/lib/api/auth";
import { preflightResponse, withCors } from "@/lib/api/cors";
import { MAX_CONTACT_BATCH, MIN_CONTACT_BATCH, matchContacts } from "@/lib/contacts/contact-matching";
import { createRequestId, logBackendEvent } from "@/lib/observability/logger";
import { consumeRateLimit, rateLimitMessage } from "@/lib/security/rate-limit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSupabaseServerEnv } from "@/lib/supabase/env";

/**
 * Contact matching.
 *
 * POST ONLY, and batch only. There is deliberately no
 * `GET /contacts/match?phone=...`: a route that answers about a single number
 * is an oracle for testing whether any given person has an account, and no
 * amount of rate limiting makes that safe.
 *
 * Authenticated through the same dual-auth resolver every other native
 * endpoint uses, so a web cookie session and a mobile bearer token both work
 * and both run as a real user.
 *
 * Numbers are submitted RAW. Normalisation and identifier derivation happen
 * server-side -- a client-supplied identifier would let someone submit hashes
 * they never derived from real numbers, and a client-supplied E.164 string may
 * not be what the server would have produced.
 */

const bodySchema = z.object({
  // Bounded at the schema, before any work happens. An oversized array is
  // rejected without normalising a hundred thousand strings first.
  phoneNumbers: z
    .array(z.string().max(40))
    .min(MIN_CONTACT_BATCH)
    .max(MAX_CONTACT_BATCH),
  // The region for numbers saved without a country code. Two letters only.
  region: z
    .string()
    .regex(/^[A-Z]{2}$/)
    .optional()
});

export function OPTIONS(request: Request) {
  return preflightResponse(request);
}

export async function POST(request: Request) {
  const requestId = createRequestId();
  const env = getSupabaseServerEnv();

  if (!env.url || !env.serviceRoleKey) {
    return withCors(
      NextResponse.json({ error: "Contact matching isn't available right now." }, { status: 503 }),
      request
    );
  }

  const auth = await resolveApiUser(request);
  if (!auth) {
    // Generic, and identical to every other unauthenticated response here.
    return withCors(NextResponse.json({ error: "Authentication required." }, { status: 401 }), request);
  }

  const userId = auth.user.id;

  // RATE LIMITED BEFORE PARSING. Five per day: contact matching is something a
  // person does when they join and occasionally after, not repeatedly. A
  // generous limit here would let someone walk the number space in batches.
  const rateLimit = await consumeRateLimit({ action: "contacts.match", userId, requestId });
  if (!rateLimit.allowed) {
    logBackendEvent("warn", {
      requestId,
      action: "contacts.match",
      statusCode: 429,
      userId,
      errorType: "rate_limited"
    });
    return withCors(NextResponse.json({ error: rateLimitMessage(rateLimit.resetAt) }, { status: 429 }), request);
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return withCors(
      NextResponse.json(
        { error: `Send between ${MIN_CONTACT_BATCH} and ${MAX_CONTACT_BATCH} contacts.` },
        { status: 400 }
      ),
      request
    );
  }

  const admin = createSupabaseAdminClient();
  const result = await matchContacts(admin, {
    viewerId: userId,
    rawNumbers: parsed.data.phoneNumbers,
    region: parsed.data.region as never,
    requestId
  });

  if (!result.ok) {
    const status = result.reason === "unconfigured" ? 503 : result.reason === "failed" ? 500 : 400;
    return withCors(NextResponse.json({ error: result.message }, { status }), request);
  }

  return withCors(
    NextResponse.json(
      {
        // Safe projections only. No phone numbers, no identifiers, and no
        // indication of which submitted contact produced which match.
        matches: result.matches,
        // Counts, so a client can say "5 of your 300 contacts are here"
        // without learning anything about the other 295.
        submitted: result.submitted,
        usable: result.usable
      },
      // Never cached: a match list is per-viewer and changes with blocks and
      // discovery settings.
      { headers: { "Cache-Control": "private, no-store" } }
    ),
    request
  );
}
