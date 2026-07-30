import { SafeArrivalPage } from "@/components/safety/safe-arrival-page";
import { getCurrentSubscriptionAccess } from "@/lib/premium/access";
import { safeArrivalLimitsFor } from "@/lib/safety/safe-arrival";
import {
  loadSafeArrivalJourneyById,
  loadSafeArrivalJourneys,
  loadSafeArrivalWatcherOptions,
  type SafeArrivalJourney,
  type SafeArrivalWatcherOption
} from "@/lib/safety/safe-arrival-service";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSupabaseServerEnv } from "@/lib/supabase/env";
import { getCurrentUser } from "@/lib/supabase/auth";

export const dynamic = "force-dynamic";

export default async function SafeArrivalRoute({
  searchParams
}: {
  searchParams: Promise<{ session?: string }>;
}) {
  const [user, params] = await Promise.all([getCurrentUser(), searchParams]);

  const env = getSupabaseServerEnv();
  let travelling: SafeArrivalJourney[] = [];
  let checkingOn: SafeArrivalJourney[] = [];
  let watcherOptions: SafeArrivalWatcherOption[] = [];
  let maxWatchers = 0;
  let plan: "free" | "buddy_plus" | "buddy_pro" = "free";
  // A journey opened straight from a notification, which may be TERMINAL (an
  // "arrived safely" alert has to open the journey that just completed, not a
  // dead end) and so is fetched separately from the live lists.
  let focusedJourney: SafeArrivalJourney | null = null;

  if (user && env.url && env.serviceRoleKey) {
    const admin = createSupabaseAdminClient();
    const [journeys, options, access] = await Promise.all([
      loadSafeArrivalJourneys(admin, user.id),
      loadSafeArrivalWatcherOptions(admin, user.id),
      getCurrentSubscriptionAccess(user.id)
    ]);

    travelling = journeys.travelling;
    checkingOn = journeys.checkingOn;
    watcherOptions = options;
    plan = access.plan;
    // Resolved on the SERVER so admin tier overrides and grace periods are
    // honoured. The client is told the number, never trusted to decide it.
    maxWatchers = safeArrivalLimitsFor(access.plan).maxContacts;

    const requested = params.session;
    if (requested && !journeys.checkingOn.some((journey: SafeArrivalJourney) => journey.id === requested)) {
      // Not in the live watching list: either the traveller's own journey, or a
      // journey that has already ended. loadSafeArrivalJourneyById re-checks
      // access, so an id belonging to somebody else resolves to null.
      focusedJourney = await loadSafeArrivalJourneyById(admin, user.id, requested);
    }
  }

  return (
    <SafeArrivalPage
      travelling={travelling}
      checkingOn={checkingOn}
      watcherOptions={watcherOptions}
      maxWatchers={maxWatchers}
      plan={plan}
      focusedJourney={focusedJourney}
      requestedSessionId={params.session ?? null}
    />
  );
}
