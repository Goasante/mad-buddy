import "server-only";
import { z } from "zod";
import type { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { deliverNotification } from "@/lib/notifications/server";
import { MEETUP_NOTIFICATION_COPY } from "@/lib/meetups/rules";
import { logBackendEvent } from "@/lib/observability/logger";
import { optionalFeatureEnabled } from "@/lib/features/availability-server";

const rowSchema = z.object({ id: z.string().uuid(), lease_id: z.string().uuid(), meetup_id: z.string().uuid(),
  recipient_id: z.string().uuid(), sender_id: z.string().uuid(), event: z.string(), dedupe_key: z.string() });
export async function processMeetupNotifications(admin: ReturnType<typeof createSupabaseAdminClient>) {
  if (!(await optionalFeatureEnabled("safe_arrival"))) return 0;
  const claimed = await admin.rpc("claim_meetup_notifications", { p_limit: 100 });
  if (claimed.error) throw claimed.error;
  const rows = z.array(rowSchema).parse(claimed.data);
  const senderIds = [...new Set(rows.map((row) => row.sender_id))];
  const senderProfiles = senderIds.length
    ? await admin.from("profiles").select("user_id,full_name,username").in("user_id", senderIds)
    : { data: [], error: null };
  if (senderProfiles.error) throw senderProfiles.error;
  const senderNames = new Map(
    (senderProfiles.data ?? []).map((profile) => [
      profile.user_id,
      profile.full_name || profile.username || "A Muddy"
    ])
  );

  let delivered = 0;
  for (const row of rows) {
    try {
      const permitted = await admin.rpc("meetup_notification_allowed", { p_id: row.id, p_lease_id: row.lease_id });
      if (permitted.error) throw permitted.error;
      if (permitted.data && MEETUP_NOTIFICATION_COPY[row.event]) {
        const senderName = senderNames.get(row.sender_id) ?? "A Muddy";
        const baseMessage = MEETUP_NOTIFICATION_COPY[row.event];
        const message = baseMessage.startsWith("A Muddy")
          ? senderName + baseMessage.slice("A Muddy".length)
          : baseMessage;
        const result = await deliverNotification(admin, { userId: row.recipient_id, senderId: row.sender_id,
          type: `meetup:${row.meetup_id}`, title: "Meet Up", message,
          category: "plans", priority: "normal", dedupeKey: row.dedupe_key });
        if (result.inApp || result.push) delivered++;
      }
      const done = await admin.rpc("finish_meetup_notification", { p_id: row.id, p_lease_id: row.lease_id, p_sent: true });
      if (done.error) throw done.error;
    } catch {
      logBackendEvent("warn", { action: "meetups.notification_retry", errorType: "DeliveryFailed" });
      const retry = await admin.rpc("finish_meetup_notification", { p_id: row.id, p_lease_id: row.lease_id, p_sent: false });
      if (retry.error) throw retry.error;
    }
  }
  return delivered;
}
