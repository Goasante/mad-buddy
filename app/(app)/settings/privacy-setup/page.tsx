import { PrivacySetupPanel } from "@/components/onboarding/privacy-setup-panel";
import { SettingsSubHeader } from "@/components/settings/settings-sub-header";

export const dynamic = "force-dynamic";

export default function PrivacySetupRoute() {
  return (
    <div className="mr-auto max-w-[640px] space-y-6 pt-6">
      <SettingsSubHeader
        title="Privacy setup"
        description="Choose who can see you and how you can be reached. You start hidden."
      />
      <PrivacySetupPanel />
    </div>
  );
}
