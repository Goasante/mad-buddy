import { NextResponse } from "next/server";
import { z } from "zod";

import { resolveApiUser } from "@/lib/api/auth";
import { preflightResponse, withCors } from "@/lib/api/cors";
import { deleteAccountForUser } from "@/lib/account/deletion";
import { consumeRateLimit, rateLimitMessage } from "@/lib/security/rate-limit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSupabaseServerEnv } from "@/lib/supabase/env";

/**
 * Account deletion for the native app.
 *
 * The web flow is a Server Action, which depends on a cookie session the
 * native client does not have. Both stores require deletion to be reachable
 * from inside the app that created the account, so this exposes the SAME
 * workflow over the dual-auth pattern the other native endpoints use.
 *
 * It is not a second implementation: the ordering, the intent record and the
 * idempotent purge all come from lib/account/deletion, so web and native
 * cannot drift into deleting different things.
 */

const bodySchema = z.object({
  // Explicit and required. Deletion must be a decision, not something a
  // mistyped request can trigger.
  confirm: z.literal(true),
  reason: z.string().trim().max(500).optional()
});

export function OPTIONS(request: Request) {
  return preflightResponse(request);
}

export async function POST(request: Request) {
  const env = getSupabaseServerEnv();
  if (!env.url || !env.serviceRoleKey) {
    return withCors(
      NextResponse.json({ error: "Account deletion is not available right now." }, { status: 503 }),
      request
    );
  }

  const auth = await resolveApiUser(request);
  if (!auth) {
    return withCors(NextResponse.json({ error: "Authentication required." }, { status: 401 }), request);
  }

  const userId = auth.user.id;

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return withCors(
      NextResponse.json({ error: "Confirm deletion before deleting your account." }, { status: 400 }),
      request
    );
  }

  const rateLimit = await consumeRateLimit({ action: "account.delete", userId });
  if (!rateLimit.allowed) {
    return withCors(
      NextResponse.json({ error: rateLimitMessage(rateLimit.resetAt) }, { status: 429 }),
      request
    );
  }

  const admin = createSupabaseAdminClient();

  const outcome = await deleteAccountForUser(admin, userId, parsed.data.reason ?? null);
  if (!outcome.ok) {
    return withCors(
      NextResponse.json(
        { error: outcome.message, dataDeleted: outcome.stage === "audited" },
        { status: 500 }
      ),
      request
    );
  }

  return withCors(NextResponse.json({ ok: true }), request);
}
