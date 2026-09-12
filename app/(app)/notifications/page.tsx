import { WebNotificationsPage } from "@/components/notifications/web-notifications-page";
import { toNotificationResponse } from "@/lib/notifications/server";
import { getCurrentIdentity } from "@/lib/supabase/auth";
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
  const [supabase, user] = await Promise.all([createSupabaseServerClient(), getCurrentIdentity()]);
  /* The subscription lookup that used to run here is gone. It existed only to
     decide `canSendCustomMessages`, which is now free -- so Notifications no
     longer touches the billing system at all, and one page load stopped doing a
     tier resolution it never needed. */
  const [notificationsResult, preferencesResult] = user
    ? await Promise.all([
        supabase
          .from("notifications")
          .select("*")
          .eq("user_id", user.id)
          .not("type", "like", CONVERSATION_NOTIFICATION_TYPE_PATTERNS[0])
          .not("type", "like", CONVERSATION_NOTIFICATION_TYPE_PATTERNS[1])
          .order("created_at", { ascending: false })
          .limit(50),
        /* The quick-settings toggles. These used to be local state that reset
           on every reload, while the native app had been persisting them all
           along; the shared screen now saves on both platforms, so the saved
           values have to be read here too or the switches would still open in
           their default position. */
        supabase
          .from("user_preferences")
          .select("notification_preferences")
          .eq("user_id", user.id)
          .maybeSingle()
      ])
    : [null, null];

  /* Defaults match lib/settings/service.ts: nearby and plan alerts are ON
     unless explicitly disabled, quiet is OFF unless explicitly enabled. */
  const storedPreferences = (preferencesResult?.data?.notification_preferences ?? {}) as Record<string, unknown>;
  const initialPreferences = {
    nearbyAlerts: storedPreferences.nearbyAlerts !== false,
    quietNearby: storedPreferences.quietNearby === true,
    planAlerts: storedPreferences.planAlerts !== false
  };

  const initialNotifications: Array<ReturnType<typeof toNotificationResponse> & { previewOnly?: boolean }> =
    (notificationsResult?.data ?? []).map(toNotificationResponse);
  if (birthdayPreview && user) {
    initialNotifications.unshift({
      id: "birthday-preview",
      type: `birthday:${user.id}`,
      title: birthdayTitle(user.userMetadata?.full_name as string | undefined ?? "Kofi"),
      message: "Send a birthday wish. Preview only.",
      is_read: false,
      created_at: new Date().toISOString(),
      previewOnly: true
    });
  }
  // Relative labels must use the same instant in the server HTML and the
  // first client render; even a one-millisecond-independent Date.now() can
  // cross a minute boundary while the page hydrates.
  // eslint-disable-next-line react-hooks/purity -- deliberate server-render snapshot passed verbatim to hydration
  const serverNowMs = Date.now();

  return (
    <WebNotificationsPage
      /* FREE CORE (Monetization Reset). This was `access?.hasPremium`, gating a
         MESSAGING capability on the old tier authority -- and messaging is free
         forever under the access model. The two paid surfaces are Linkr and
         UpFor; writing a message to a Muddy is neither. */
      canSendCustomMessages
      initialNotifications={initialNotifications}
      initialNowMs={serverNowMs}
      initialPreferences={initialPreferences}
    />
  );
}
