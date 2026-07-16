import { NotificationsPageContent } from "@/components/notifications/notifications-page";
import { getCurrentSubscriptionAccess } from "@/lib/premium/access";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function NotificationsPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  const access = user ? await getCurrentSubscriptionAccess(user.id) : null;

  return <NotificationsPageContent canSendCustomMessages={access?.hasPremium ?? false} />;
}
