import { getEventsAction } from "@/app/(app)/event-actions";
import { EventsPageContent } from "@/components/events/events-page";

export default async function EventsPage() {
  const events = await getEventsAction();
  return <EventsPageContent initialEvents={events} />;
}
