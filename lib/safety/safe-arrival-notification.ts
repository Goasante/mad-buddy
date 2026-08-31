import "server-only";

import { deliverNotification } from "@/lib/notifications/server";
import { safeArrivalNotification } from "@/lib/safety/safe-arrival";
import type { createSupabaseAdminClient } from "@/lib/supabase/admin";

type Admin = ReturnType<typeof createSupabaseAdminClient>;

export type SafeArrivalNotificationIntent = {
  sessionId: string;
  recipientId: string;
  event: "started" | "arrived" | "cancelled" | "extended" | "unconfirmed" | "expired";
  actorId?: string | null;
  notificationKey?: string;
};

export async function deliverSafeArrivalNotificationIntent(admin: Admin, intent: SafeArrivalNotificationIntent) {
  const { data: session } = await admin.from("safe_arrival_sessions")
    .select("id, traveller_id, destination_label, expected_arrival_at").eq("id", intent.sessionId).maybeSingle();
  if (!session) return 0;
  const { data: profile } = await admin.from("profiles").select("full_name")
    .eq("user_id", session.traveller_id).maybeSingle();
  const travellerName = profile?.full_name?.trim() || "A Muddy";
  const copy = intent.event === "expired"
    ? { title: "Safe Arrival ended", message: `${travellerName}'s Safe Arrival ended without confirmation.` }
    : safeArrivalNotification(intent.event === "unconfirmed" ? "overdue" : intent.event, {
        travellerName,
        destinationLabel: session.destination_label,
        timeLabel: new Date(session.expected_arrival_at).toLocaleTimeString("en-GB", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Africa/Accra" })
      });
  const dedupeKey = intent.notificationKey ?? `safe-arrival:${intent.sessionId}:${intent.recipientId}:${intent.event}`;
  const result = await deliverNotification(admin, {
    userId: intent.recipientId,
    senderId: session.traveller_id,
    priority: intent.event === "unconfirmed" || intent.event === "expired" ? "critical" : "high",
    type: `safe_arrival:${intent.sessionId}`,
    title: copy.title,
    message: copy.message,
    dedupeKey
  });
  return result.inApp ? 1 : 0;
}
