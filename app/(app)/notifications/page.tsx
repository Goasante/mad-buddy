import { NotificationsPageContent } from "@/components/notifications/notifications-page";
import { getCurrentSubscriptionAccess } from "@/lib/premium/access";
import { getCurrentUser } from "@/lib/supabase/auth";

export default async function NotificationsPage() {
  const user = await getCurrentUser();
  const access = user ? await getCurrentSubscriptionAccess(user.id) : null;

  return <NotificationsPageContent canSendCustomMessages={access?.hasPremium ?? false} />;
}
