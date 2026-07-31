import { SettingsSubHeader } from "@/components/settings/settings-sub-header";
import { WalkthroughReplay } from "@/components/tours/walkthrough-replay";
import { getReplayableTours } from "@/lib/tours/service";
import { getCurrentUser } from "@/lib/supabase/auth";

export default async function WalkthroughPage() {
  const user = await getCurrentUser();
  const tours = user ? await getReplayableTours(user.id) : [];

  return (
    <div className="mr-auto max-w-[720px] space-y-6 pt-6">
      <SettingsSubHeader title="Feature guides" description="Learn a feature for the first time or replay any guide." />
      <WalkthroughReplay
        tours={tours.map((tour) => ({
          tourVersionId: tour.tourVersionId,
          slug: tour.slug,
          title: tour.title,
          description: tour.description,
          version: tour.version,
          stepCount: tour.steps.length,
          progressStatus: tour.progressStatus
        }))}
      />
    </div>
  );
}
