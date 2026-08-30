import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

type Admin = SupabaseClient<Database>;

/**
 * The audience fan-out for an UpFor, claimed exactly once.
 *
 * TWO ACTORS WANT TO DO THIS. Creation announces an UpFor that starts now; the
 * polling worker announces one that was scheduled, and tries again on every
 * retry. Both would otherwise read `audience_notified_at IS NULL`, both would
 * pass, and the audience would hear twice.
 *
 * So neither reads first. `claim_upfor_announcement` does the check and the
 * write as one UPDATE, and returns whether THIS caller was the one that
 * claimed it. Only the winner sends.
 *
 * CLAIM BEFORE SEND, DELIBERATELY. Claiming afterwards would mean a crash
 * part-way through the fan-out leaves the row unclaimed, and the next tick
 * announces the session again to everyone who already heard. One missed
 * announcement is a better failure than a repeated one, and the notification
 * itself is not the product -- the UpFor is still discoverable, and the person
 * still appears in "Muddies open to plans".
 *
 * That is the honest meaning of `audience_notified_at`: "this fan-out has been
 * claimed and attempted", not "every recipient definitely received it".
 * Per-recipient delivery has its own retry inside deliverNotification.
 */
export async function announceUpForToAudience(
  admin: Admin,
  args: {
    sessionId: string;
    ownerId: string;
    /**
     * Whether the session must already have started to be claimable.
     *
     * The worker always passes true. The creation path passes false only for an
     * UpFor beginning now, where `starts_at <= now()` is true anyway -- it is
     * spelled out rather than relied upon so a clock skew of a few milliseconds
     * between the app server and the database cannot silently drop the
     * announcement of an immediate UpFor.
     */
    requireStarted: boolean;
    resolveRecipients: () => Promise<string[]>;
    senderName: () => Promise<string>;
    note?: string | null;
    deliver: (recipientId: string, title: string, message: string) => Promise<unknown>;
  }
): Promise<{ claimed: boolean; recipients: number }> {
  const { data: claimed, error } = await admin.rpc("claim_upfor_announcement", {
    p_session_id: args.sessionId,
    p_require_started: args.requireStarted
  });

  // A failed claim is not an error: it means somebody else already owns this
  // fan-out, or the session is not eligible yet. Either way, send nothing.
  if (error || claimed !== true) return { claimed: false, recipients: 0 };

  const recipients = await args.resolveRecipients();
  if (recipients.length === 0) return { claimed: true, recipients: 0 };

  const name = await args.senderName();
  const note = args.note?.trim();
  const message = note
    ? `${name} is open to hang out: “${note}”`
    : `${name} is open to hang out. Tap to show interest.`;

  await Promise.all(
    recipients.map((recipientId) =>
      args.deliver(recipientId, "A Muddy is open to hang out", message)
    )
  );

  return { claimed: true, recipients: recipients.length };
}
