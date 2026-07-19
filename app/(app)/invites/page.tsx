import { InvitesPageContent } from "@/components/invites/invites-page";
import { loadGroupsPageDataAction } from "@/app/(app)/group-actions";

export const dynamic = "force-dynamic";

export default async function InvitesPage() {
  const data = await loadGroupsPageDataAction();
  return <InvitesPageContent initialInvitations={data.invitations} />;
}
