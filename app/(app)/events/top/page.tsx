import { PageHeader } from "@/components/app-shell/page-header";
import { TopEventsList } from "@/components/events/top-events-list";
import { getRankedUpcomingEvents } from "@/lib/events/ranked-events";
import { MAX_RANKED_EVENTS } from "@/lib/events/ranking";
import { getCurrentUser } from "@/lib/supabase/auth";

/**
 * The ranked Events destination (Ranked Events Discovery).
 *
 * Asks for the full ranking (up to 100) where Home asks for 5 -- the SAME
 * loader with a different limit, so the two can never disagree about what
 * rank an event holds. The consumer-facing title stays "Top Events"; the
 * hundred is the system's cap, not a promise about how many exist.
 */
export default async function TopEventsPage() {
  const user = await getCurrentUser();
  const events = user ? await getRankedUpcomingEvents(user.id, { limit: MAX_RANKED_EVENTS }) : [];

  return (
    <div className="space-y-4">
      <PageHeader title="Top Events" backHref="/dashboard" />
      <TopEventsList events={events} />
    </div>
  );
}
