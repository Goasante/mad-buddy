import { InviteBuddiesPage } from "@/components/invite/invite-buddies-page";
import { getPersonalQrAction } from "@/app/(app)/invite-actions";

export const dynamic = "force-dynamic";

export default async function InvitePage() {
  const qr = await getPersonalQrAction();
  return <InviteBuddiesPage initialQr={qr} />;
}
