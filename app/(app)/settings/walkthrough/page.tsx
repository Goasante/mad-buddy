import { SettingsSubHeader } from "@/components/settings/settings-sub-header";
import { WalkthroughReplay } from "@/components/tours/walkthrough-replay";
import { getReplayableTours } from "@/lib/tours/service";
import { getCurrentUser } from "@/lib/supabase/auth";

export default async function WalkthroughPage() {
  const user = await getCurrentUser();
  const tours = user ? await getReplayableTours(user.id) : [];

  return (
    <div className="mr-auto max-w-[560px] space-y-6 pt-6">
      <SettingsSubHeader title="App walkthrough" description="Revisit any Mad Buddy tour whenever you like." />
      <WalkthroughReplay tours={tours} />
    </div>
  );
}
