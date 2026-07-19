import { MeetingPingsPage } from "@/components/meeting-pings/meeting-pings-page";
import { loadMeetingPingsAction } from "@/app/(app)/premium-actions";

export const dynamic = "force-dynamic";

export default async function MeetingPingsRoute() {
  const pings = await loadMeetingPingsAction();
  return <MeetingPingsPage initialPings={pings} />;
}
