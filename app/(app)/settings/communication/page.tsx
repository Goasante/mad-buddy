import { getCommunicationPreferencesAction } from "@/app/(app)/messaging-actions";
import { CommunicationSettingsPage } from "@/components/settings/communication-page";
import { SettingsSubHeader } from "@/components/settings/settings-sub-header";

export const dynamic = "force-dynamic";

export default async function CommunicationSettingsRoute() {
  const preferences = await getCommunicationPreferencesAction();
  return (
    <div className="mr-auto max-w-[640px] space-y-6 pt-6">
      <SettingsSubHeader
        title="Messaging privacy"
        description="Who can reach you, and what others can see about how you use chat."
      />
      <CommunicationSettingsPage initialPreferences={preferences} />
    </div>
  );
}
