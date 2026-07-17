import { getEngagementOverviewAction } from "@/app/(app)/engagement-actions";
import { BadgesPageContent } from "@/components/badges/badges-page";

export default async function BadgesPage() {
  const overview = await getEngagementOverviewAction();
  return <BadgesPageContent overview={overview} />;
}
