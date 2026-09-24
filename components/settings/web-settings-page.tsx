"use client";

import { useMemo } from "react";
import dynamic from "next/dynamic";
import {
  updateNotificationPreferenceAction,
  updateVisibilityStatusAction
} from "@/app/(app)/settings-actions";
import { SettingsPageContent } from "@/components/settings/settings-page";
import { PageHeader } from "@/components/app-shell/page-header";
import type { SettingsClient } from "@/lib/settings/client";
import { enableLocationForGlowOnWeb } from "@/lib/settings/web-client";

/**
 * The web app's Settings screen.
 *
 * A thin client boundary around the shared component, holding the three things
 * that cannot be shared:
 *
 *  - the two Server Actions, which the shared component must never import
 *    because it also renders inside the native bundle;
 *  - PageHeader, which reaches next/navigation;
 *  - the delete-account modal, which imports a Server Action of its own.
 *
 * next/dynamic stays here rather than moving to React.lazy: this file is
 * web-only, and Next's own loader is the better fit inside Next.
 */

// Deferred: most visits to Settings never open this — no reason to ship its
// JS on every Settings page load.
const DeleteAccountModal = dynamic(() =>
  import("@/components/settings/delete-account-modal").then((mod) => mod.DeleteAccountModal)
);

/** Everything the shared screen takes, minus what this boundary supplies. */
type Props = Omit<
  React.ComponentProps<typeof SettingsPageContent>,
  "client" | "header" | "renderDeleteAccountModal"
>;

export function WebSettingsPage(props: Props) {
  const client = useMemo<SettingsClient>(
    () => ({
      async setVisibilityStatus(status) {
        const result = await updateVisibilityStatusAction(status);
        return { ok: result.ok, message: result.message };
      },
      async setNearbyAlerts(enabled) {
        const result = await updateNotificationPreferenceAction({ nearbyAlerts: enabled });
        return { ok: result.ok, message: result.message };
      },
      enableLocationForGlow: enableLocationForGlowOnWeb
    }),
    []
  );

  return (
    <SettingsPageContent
      {...props}
      client={client}
      header={<PageHeader title="Settings" />}
      renderDeleteAccountModal={({ open, onOpenChange }) => (
        <DeleteAccountModal open={open} onOpenChange={onOpenChange} />
      )}
    />
  );
}
