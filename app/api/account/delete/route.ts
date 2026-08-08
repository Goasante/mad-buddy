import { NextResponse } from "next/server";
import { z } from "zod";

import { resolveApiUser } from "@/lib/api/auth";
import { preflightResponse, withCors } from "@/lib/api/cors";
import { markDeletionRequested, purgeUserData, recordDeletionStage } from "@/lib/account/deletion";
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

  // INTENT FIRST. Written before anything is destroyed, so a failure part-way
  // through is resumable rather than silently losing the fact that this user
  // asked at all. Idempotent on user_id: a retry after a dropped mobile
  // connection re-asserts the same request instead of starting a second one.
  const intent = await markDeletionRequested(admin, userId, parsed.data.reason ?? null);
  if (!intent.ok) {
    return withCors(
      NextResponse.json({ error: intent.message ?? "Your deletion request could not be recorded." }, { status: 500 }),
      request
    );
  }

  const { data: profile } = await admin
    .from("profiles")
    .select("full_name, username")
    .eq("user_id", userId)
    .maybeSingle();

  const { error: reportError } = await admin.rpc("prepare_deleted_user_reports", { target_user_id: userId });
  if (reportError) {
    // Nothing destroyed yet; the intent row survives and a retry starts here.
    return withCors(
      NextResponse.json({ error: "Your account could not be prepared for deletion." }, { status: 500 }),
      request
    );
  }
  await recordDeletionStage(admin, userId, "reports_anonymised");

  const purge = await purgeUserData(admin, userId);
  if (!purge.ok) {
    // Every delete is idempotent, so retrying repeats the whole step safely
    // rather than needing to know exactly where it stopped.
    return withCors(
      NextResponse.json({ error: "Your account data could not be removed." }, { status: 500 }),
      request
    );
  }
  await recordDeletionStage(admin, userId, "data_purged");

  const label = profile?.username
    ? `Deleted User (@${profile.username})`
    : profile?.full_name
      ? `Deleted User (${profile.full_name})`
      : "Deleted User";

  const { error: auditError } = await admin.from("deletion_audit_logs").insert({
    user_id: userId,
    deleted_user_label: label,
    deletion_reason: parsed.data.reason ?? null,
    retained_report_reference: "reports anonymized with prepare_deleted_user_reports"
  });
  if (auditError) {
    return withCors(
      NextResponse.json({ error: "The deletion audit record could not be saved." }, { status: 500 }),
      request
    );
  }
  await recordDeletionStage(admin, userId, "audited");

  const { error: authError } = await admin.auth.admin.deleteUser(userId);
  if (authError) {
    // The data is gone; only the login remains. Reported honestly rather than
    // as a plain failure, because telling someone deletion failed when their
    // data has already been erased is the opposite of what happened. The intent
    // row stays at 'audited' so this resumes on the next attempt.
    return withCors(
      NextResponse.json(
        {
          error:
            "Your data has been deleted, but your sign-in could not be removed yet. Signing in again will complete it.",
          dataDeleted: true
        },
        { status: 500 }
      ),
      request
    );
  }

  // Completed. The intent row would otherwise outlive the account it describes;
  // deletion_audit_logs is the durable history, not this.
  await admin.from("account_deletion_requests").delete().eq("user_id", userId);

  return withCors(NextResponse.json({ ok: true }), request);
}
