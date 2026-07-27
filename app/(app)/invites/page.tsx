import { InvitesPageContent } from "@/components/invites/invites-page";
import { loadGroupsPageDataAction } from "@/app/(app)/group-actions";
import { listIncomingRequests } from "@/lib/friends/service";
import { getCurrentUser } from "@/lib/supabase/auth";

export const dynamic = "force-dynamic";

export default async function InvitesPage() {
  const user = await getCurrentUser();
  // getCurrentUser() is request-cached, so this shares the same getUser round
  // trip loadGroupsPageDataAction makes — no extra auth cost. Both run in
  // parallel so the page's data is one fan-out, not a waterfall.
  const [data, incoming] = await Promise.all([
    loadGroupsPageDataAction(),
    user ? listIncomingRequests(user.id) : Promise.resolve({ ok: true, message: "", requests: [] })
  ]);

  return (
    <InvitesPageContent
      initialInvitations={data.invitations}
      muddyRequestCount={incoming.requests.length}
    />
  );
}
