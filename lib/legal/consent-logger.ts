import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { PRIVACY_POLICY_VERSION, type ConsentLogger, type PolicyConsentEvent } from "@/lib/legal/consent";
import { logBackendEvent } from "@/lib/observability/logger";

/**
 * Durable consent records, written through the service role.
 *
 * WHAT IS RECORDED IS ONLY WHAT THE UI ACTUALLY COLLECTED. The signup form has
 * a single checkbox covering the Terms and the Privacy Policy, so exactly one
 * row is written for it. Splitting that into separate "terms" and "privacy"
 * consents would claim two decisions from one tick, which is worse than not
 * logging at all -- a consent record that overstates what someone agreed to is
 * evidence of the wrong thing.
 *
 * THE USER ID IS NEVER TAKEN FROM THE CLIENT. Callers pass the id returned by
 * account creation on the server. A client-supplied id would let one account
 * write consent attributed to another.
 *
 * THE TIMESTAMP IS THE DATABASE'S. created_at defaults to now(), and this
 * deliberately does not send one: a client clock -- or a server retry minutes
 * later -- would otherwise decide when consent was given.
 */

/** The consent the signup checkbox represents. One tick, one row. */
export const SIGNUP_CONSENT_TYPE = "privacy_policy" as const;

export function consentTextFor(policyVersion: string): string {
  // Stored verbatim so an auditor can see what the person agreed to without
  // reconstructing which copy shipped that day.
  return `Accepted the Mad Buddy Terms of Service and Privacy Policy (version ${policyVersion}) at signup.`;
}

export function createConsentLogger(admin: SupabaseClient): ConsentLogger {
  return {
    async logConsent(event: PolicyConsentEvent): Promise<void> {
      const { error } = await admin.from("consent_logs").insert({
        user_id: event.userId,
        consent_type: SIGNUP_CONSENT_TYPE,
        consent_text: consentTextFor(event.policyVersion),
        granted: true
        // created_at intentionally omitted; the column defaults to now() so the
        // database owns the time, not this process.
      });

      if (error) {
        // Thrown, not swallowed. The caller decides whether a consent failure
        // should fail the whole signup -- but it must never pass silently,
        // which is what the previous no-op logger did.
        throw error;
      }
    }
  };
}

/**
 * Records the signup consent, and reports whether it worked.
 *
 * FAILURE BEHAVIOUR IS EXPLICIT AND DELIBERATE: a consent write that fails
 * does NOT fail the signup.
 *
 * The reasoning is that the alternative is worse. Consent is inserted after the
 * account exists, because it needs a real user id; if a failure here rolled the
 * signup back, a transient database error would delete an account the person
 * successfully created and told they had. And refusing to create the account
 * until consent is stored is not available either -- there is no user id to
 * attribute it to yet.
 *
 * So the account stands and the failure is logged at error level with the user
 * id, which is what makes it recoverable: the row can be backfilled from the
 * log. What is NOT acceptable is silence, and that is the specific thing this
 * function exists to prevent.
 *
 * If Mad Buddy ever needs consent to be legally blocking, the correct shape is
 * a pre-registration consent record keyed on the email, written before the
 * account -- not a rollback bolted onto this path.
 */
export async function recordSignupConsent(
  admin: SupabaseClient,
  {
    userId,
    requestId,
    source
  }: {
    userId: string;
    requestId: string;
    source: PolicyConsentEvent["source"];
  }
): Promise<{ ok: boolean }> {
  try {
    await createConsentLogger(admin).logConsent({
      userId,
      policyVersion: PRIVACY_POLICY_VERSION,
      // Informational only: the stored timestamp is the database default.
      acceptedAt: new Date().toISOString(),
      source
    });
    return { ok: true };
  } catch (error) {
    logBackendEvent("error", {
      requestId,
      action: "auth.signup_consent",
      statusCode: 500,
      userId,
      errorType: error instanceof Error ? error.name : "consent_log_failed"
    });
    return { ok: false };
  }
}
