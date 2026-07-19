import { GroupsPageContent } from "@/components/groups/groups-page";
import { loadGroupsPageDataAction } from "@/app/(app)/group-actions";

export default async function GroupsPage() {
  const data = await loadGroupsPageDataAction();
  return <GroupsPageContent initialData={data} />;
}
