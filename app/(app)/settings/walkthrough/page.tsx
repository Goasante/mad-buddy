import { SettingsSubHeader } from "@/components/settings/settings-sub-header";
import { WalkthroughReplay } from "@/components/tours/walkthrough-replay";
import { getReplayableTours } from "@/lib/tours/service";
import { getCurrentUser } from "@/lib/supabase/auth";

export default async function WalkthroughPage() {
  const user = await getCurrentUser();
  const tours = user ? await getReplayableTours(user.id) : [];

  return (
    <div className="mr-auto max-w-[560px] space-y-6 pt-6">
      <SettingsSubHeader title="Replay app walkthrough" description="Take the Mad Buddy tour again." />
      <WalkthroughReplay
        tours={tours.map((tour) => ({
          tourVersionId: tour.tourVersionId,
          slug: tour.slug,
          title: tour.title,
          description: tour.description,
          version: tour.version,
          stepCount: tour.steps.length
        }))}
      />
    </div>
  );
}
