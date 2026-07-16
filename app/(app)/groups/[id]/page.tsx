import { notFound } from "next/navigation";
import { GroupDetailPage } from "@/components/groups/group-detail-page";
import { seedGroups } from "@/components/groups/groups-page";

export default async function GroupDetailRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const group = seedGroups.find((item) => item.id === id);

  if (!group) {
    notFound();
  }

  return <GroupDetailPage group={group} />;
}
