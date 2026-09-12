import { useEffect, useState } from "react";
import { NotificationsPageContent } from "@/components/notifications/notifications-page";
import type { NotificationPreferences } from "@/lib/notifications/client";
import { useAuth } from "../auth/AuthProvider";
import { supabase } from "../lib/supabase";
import { mobileNotificationsClient } from "../lib/notifications-client";
import { useOverlayDismiss } from "../lib/overlay";
import { Spinner } from "../components/Spinner";

/**
 * Pulse on Android.
 *
 * This was a 500-line hand-written screen with its own list, filters, icon
 * mapping, selection model and birthday sheet -- all of which had drifted
 * behind the web app. It rendered 3 notification types where web rendered 11,
 * and had no meeting-ping replies, no undo, and no stale-target handling.
 *
 * It now renders the SAME component the web app does. Two things stay native:
 *
 *  - the transport, which uses a Bearer token against the API origin rather
 *    than a session cookie on a same-origin path;
 *  - useOverlayDismiss, so the hardware Back button closes an open sheet
 *    instead of leaving the screen. Web passes its own hook, whose cleanup
 *    calls history.back() -- correct there, wrong here.
 *
 * The saved toggles are read directly from Supabase, which is how this screen
 * has always done it; there is no GET endpoint, and the web app gets the same
 * values from its server render.
 */
export function NotificationsScreen() {
  const { user } = useAuth();
  const [preferences, setPreferences] = useState<NotificationPreferences | null>(null);

  useEffect(() => {
    if (!user) return;
    let active = true;
    void supabase
      .from("user_preferences")
      .select("notification_preferences")
      .eq("user_id", user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (!active) return;
        const raw = (data?.notification_preferences ?? {}) as Record<string, unknown>;
        /* Defaults match the service: nearby and plan alerts are ON unless
           explicitly disabled, quiet is OFF unless explicitly enabled. Reading
           them the other way round would show every switch in the wrong
           position for anyone who has never opened this sheet. */
        setPreferences({
          nearbyAlerts: raw.nearbyAlerts !== false,
          quietNearby: raw.quietNearby === true,
          planAlerts: raw.planAlerts !== false
        });
      });
    return () => {
      active = false;
    };
  }, [user]);

  // Waiting avoids rendering the toggles in a default position and then
  // visibly correcting them a moment later.
  if (!preferences) {
    return (
      <div className="flex justify-center py-16">
        <Spinner />
      </div>
    );
  }

  return (
    <NotificationsPageContent
      client={mobileNotificationsClient}
      useOverlayDismiss={useOverlayDismiss}
      initialPreferences={preferences}
      /* FREE CORE: writing a message to a Muddy is not one of the two paid
         surfaces, so this matches the web app rather than gating on a tier. */
      canSendCustomMessages
    />
  );
}
