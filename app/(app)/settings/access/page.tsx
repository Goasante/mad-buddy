import { redirect } from "next/navigation";

import { AccessSettingsPage } from "@/components/access/access-settings-page";
import { hasEverHadWelcomeAccess } from "@/lib/access/guard";
import { resolveAccessForUser } from "@/lib/access/resolver";
import { getCurrentUser } from "@/lib/supabase/auth";

export const dynamic = "force-dynamic";

/**
 * Settings → Mad Buddy Access.
 *
 * `force-dynamic` is not boilerplate here: access state is time-dependent, and
 * a cached render could tell somebody they still have days left after their
 * window closed. The resolver reads server time on every request.
 */
export default async function AccessSettingsRoute() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const [access, hadWelcomeAccess] = await Promise.all([
    resolveAccessForUser(user.id),
    hasEverHadWelcomeAccess(user.id)
  ]);

  return <AccessSettingsPage access={access} hadWelcomeAccess={hadWelcomeAccess} />;
}
