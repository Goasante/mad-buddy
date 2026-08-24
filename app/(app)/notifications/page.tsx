import { NotificationsPageContent } from "@/components/notifications/notifications-page";
import { toNotificationResponse } from "@/lib/notifications/server";
import { getCurrentUser } from "@/lib/supabase/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { birthdayTitle } from "@/lib/profile/birthday-experience";
import { CONVERSATION_NOTIFICATION_TYPE_PATTERNS } from "@/lib/notifications/conversation-boundary";

export default async function NotificationsPage({
  searchParams
}: {
  searchParams?: Promise<{ birthdayPreview?: string }>;
}) {
  const params = await searchParams;
  const birthdayPreview = process.env.NODE_ENV !== "production" && params?.birthdayPreview === "1";
  const [supabase, user] = await Promise.all([createSupabaseServerClient(), getCurrentUser()]);
  /* The subscription lookup that used to run here is gone. It existed only to
     decide `canSendCustomMessages`, which is now free -- so Notifications no
     longer touches the billing system at all, and one page load stopped doing a
     tier resolution it never needed. */
  const [notificationsResult] = user
    ? await Promise.all([
        supabase
          .from("notifications")
          .select("*")
          .eq("user_id", user.id)
          .not("type", "like", CONVERSATION_NOTIFICATION_TYPE_PATTERNS[0])
          .not("type", "like", CONVERSATION_NOTIFICATION_TYPE_PATTERNS[1])
          .order("created_at", { ascending: false })
          .limit(50)
      ])
    : [null, null];

  const initialNotifications: Array<ReturnType<typeof toNotificationResponse> & { previewOnly?: boolean }> =
    (notificationsResult?.data ?? []).map(toNotificationResponse);
  if (birthdayPreview && user) {
    initialNotifications.unshift({
      id: "birthday-preview",
      type: `birthday:${user.id}`,
      title: birthdayTitle(user.user_metadata?.full_name ?? "Kofi"),
      message: "Send a birthday wish. Preview only.",
      is_read: false,
      created_at: new Date().toISOString(),
      previewOnly: true
    });
  }

  return (
    <NotificationsPageContent
      /* FREE CORE (Monetization Reset). This was `access?.hasPremium`, gating a
         MESSAGING capability on the old tier authority -- and messaging is free
         forever under the access model. The two paid surfaces are Linkr and
         UpFor; writing a message to a Muddy is neither. */
      canSendCustomMessages
      initialNotifications={initialNotifications}
    />
  );
}
