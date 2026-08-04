import { getEventsAction } from "@/app/(app)/event-actions";
import { EventsPageContent } from "@/components/events/events-page";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/supabase/auth";
import { loadEffectivePlan } from "@/lib/billing/service";

export default async function EventsPage() {
  const [events, user] = await Promise.all([getEventsAction(), getCurrentUser()]);
  const currentUserPlan = user
    ? await loadEffectivePlan(createSupabaseAdminClient(), user.id)
    : "free";
  return <EventsPageContent initialEvents={events} currentUserPlan={currentUserPlan} />;
}
