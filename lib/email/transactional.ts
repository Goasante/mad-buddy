import "server-only";

import { sendMadBuddyEmail, type SendEmailResult } from "@/lib/email/send";
import { buildMadBuddyAdminEmailHtml } from "@/lib/email/template";
import type { createSupabaseAdminClient } from "@/lib/supabase/admin";

type Admin = ReturnType<typeof createSupabaseAdminClient>;

export type TransactionalEmailResult = SendEmailResult | { ok: true; skipped: true };

/**
 * Sends an essential, app-triggered email to a user's registered account
 * address. These messages intentionally do not consult optional marketing
 * preferences: callers use this helper only for service, safety, billing,
 * security, or account lifecycle communication.
 */
export async function sendTransactionalUserEmail(
  admin: Admin,
  input: {
    userId: string;
    subject: string;
    message: string;
    idempotencyKey: string;
  }
): Promise<TransactionalEmailResult> {
  const { data, error } = await admin.auth.admin.getUserById(input.userId);
  const email = data.user?.email?.trim();
  if (error || !email) return { ok: true, skipped: true };

  const text = [
    "Mad Buddy",
    "",
    input.message,
    "",
    "The Mad Buddy Team",
    "hello@mad-buddy.com",
    "support@mad-buddy.com",
    "mad-buddy.com",
    "",
    "When your friends are close, they glow."
  ].join("\n");

  return sendMadBuddyEmail({
    to: email,
    subject: input.subject,
    text,
    html: buildMadBuddyAdminEmailHtml(input.message),
    idempotencyKey: input.idempotencyKey
  });
}
