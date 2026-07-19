import { RemindersPage } from "@/components/reminders/reminders-page";
import { loadUpcomingPlans } from "@/lib/social/upcoming-plans";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function RemindersRoute() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  const result = user ? await loadUpcomingPlans(user.id, 20) : { plans: [], hasMore: false };
  return <RemindersPage plans={result.plans} hasMore={result.hasMore} />;
}
