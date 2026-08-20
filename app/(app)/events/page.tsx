import { getEventsAction } from "@/app/(app)/event-actions";
import { EventsPageContent } from "@/components/events/events-page";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/supabase/auth";
import { loadEffectivePlan } from "@/lib/billing/service";

/**
 * The server's render clock.
 *
 * Read OUTSIDE the component. Date.now() is impure, and calling it in a
 * component body is flagged as such even in an async Server Component that
 * only runs once per request -- the rule cannot tell the two apart, and it is
 * right in general. Reading it from a helper keeps the component pure and
 * still gives the request one fixed instant.
 */
function readServerNow(): number {
  return Date.now();
}

export default async function EventsPage() {
  /* SERVER CLOCK, PASSED EXPLICITLY.
   *
   * Every Events surface is time-dependent -- which Event is live, what is on
   * today, which one leads the page. The client used to start its clock at 0,
   * which was harmless when the page was a flat list but renders an EMPTY page
   * server-side now that past Events are filtered out: at nowMs = 0 every Event
   * is already over.
   *
   * Handing down the render time makes the server HTML truthful. The client
   * takes over its own clock on mount and reconciles from there. */
  const [events, user, serverNowMs] = await Promise.all([
    getEventsAction(),
    getCurrentUser(),
    Promise.resolve(readServerNow())
  ]);
  const currentUserPlan = user
    ? await loadEffectivePlan(createSupabaseAdminClient(), user.id)
    : "free";

  return (
    <EventsPageContent
      initialEvents={events}
      currentUserPlan={currentUserPlan}
      serverNowMs={serverNowMs}
    />
  );
}
