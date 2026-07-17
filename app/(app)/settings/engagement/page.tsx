import { getEngagementSettingsAction } from "@/app/(app)/engagement-actions";
import { EngagementPage } from "@/components/settings/engagement-page";
import { SettingsSubHeader } from "@/components/settings/settings-sub-header";

export const dynamic = "force-dynamic";

export default async function EngagementSettingsRoute() {
  const settings = await getEngagementSettingsAction();
  return (
    <div className="mr-auto max-w-[640px] space-y-6 pt-6">
      <SettingsSubHeader
        title="Focus & balance"
        description="Mad Buddy is for spending time with people, not for spending time in the app."
      />
      <EngagementPage initialSettings={settings} />
    </div>
  );
}
