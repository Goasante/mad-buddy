"use client";

import { useMemo } from "react";
import { respondToMeetupRequestAction } from "@/app/(app)/premium-actions";
import { sendBirthdayWishAction } from "@/app/(app)/birthday-actions";
import { updateNotificationPreferenceAction } from "@/app/(app)/settings-actions";
import { NotificationsPageContent } from "@/components/notifications/notifications-page";
import { PageHeader } from "@/components/app-shell/page-header";
import { useDismissOnBack } from "@/hooks/use-dismiss-on-back";
import { createWebNotificationsClient } from "@/lib/notifications/web-client";

/**
 * The web app's Notifications screen.
 *
 * A thin client boundary around the shared component. It exists to supply the
 * two things that cannot be shared:
 *
 *  - the transport, which uses same-origin paths and the session cookie;
 *  - the two Server Actions, which the shared component must never import
 *    because it also renders inside the native bundle.
 *
 * useDismissOnBack is passed rather than used inside the shared component
 * because its cleanup calls history.back(), which correctly cancels an
 * in-flight App Router navigation on web but would be wrong on Android.
 */
/** Everything the shared screen takes, minus what this boundary supplies. */
type Props = Omit<
  React.ComponentProps<typeof NotificationsPageContent>,
  "client" | "useOverlayDismiss" | "header"
>;

export function WebNotificationsPage(props: Props) {
  const client = useMemo(
    () =>
      createWebNotificationsClient({
        async respondToPing(requestId, message) {
          const result = await respondToMeetupRequestAction({ requestId, message });
          return { ok: result.ok, message: result.message };
        },
        async saveNotificationPreferences(patch) {
          const result = await updateNotificationPreferenceAction(patch);
          return { ok: result.ok, message: result.message };
        },
        async sendBirthdayWish(targetUserId, wish) {
          const result = await sendBirthdayWishAction({ targetUserId, wish });
          return { ok: result.ok, message: result.message };
        }
      }),
    []
  );

  /* The header lives here, not in the shared component: PageHeader reaches
     next/link and next/navigation through MobilePageHeader, and the native app
     has no App Router for useRouter() to attach to. Android renders no header
     of its own here -- the shared AppHeader in its shell already carries one. */
  return (
    <NotificationsPageContent
      {...props}
      client={client}
      useOverlayDismiss={useDismissOnBack}
      header={<PageHeader title="Pulse" showNotifications={false} />}
    />
  );
}
