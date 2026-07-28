import { NotificationsPageContent } from "@/components/notifications/notifications-page";
import { toNotificationResponse } from "@/lib/notifications/server";
import { getCurrentSubscriptionAccess } from "@/lib/premium/access";
import { getCurrentUser } from "@/lib/supabase/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function NotificationsPage() {
  const [supabase, user] = await Promise.all([createSupabaseServerClient(), getCurrentUser()]);
  const [access, notificationsResult] = user
    ? await Promise.all([
        getCurrentSubscriptionAccess(user.id),
        supabase
          .from("notifications")
          .select("*")
          .eq("user_id", user.id)
          .order("created_at", { ascending: false })
          .limit(50)
      ])
    : [null, null];

  return (
    <NotificationsPageContent
      canSendCustomMessages={access?.hasPremium ?? false}
      initialNotifications={(notificationsResult?.data ?? []).map(toNotificationResponse)}
    />
  );
}
