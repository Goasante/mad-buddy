import type { Metadata } from "next";
import { Wrench } from "lucide-react";
import { BrandMark } from "@/components/brand/brand-mark";
import { ensureMaintenanceWarm } from "@/lib/maintenance/loader";
import { DEFAULT_MAINTENANCE_MESSAGE } from "@/lib/maintenance/state";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSupabaseServerEnv } from "@/lib/supabase/env";

export const metadata: Metadata = {
  title: "Maintenance",
  description: "Mad Buddy is temporarily unavailable.",
  robots: { index: false, follow: false }
};

// Reflects live maintenance state; never statically prerendered.
export const dynamic = "force-dynamic";

export default async function MaintenancePage() {
  const env = getSupabaseServerEnv();
  const state =
    env.url && env.serviceRoleKey
      ? await ensureMaintenanceWarm(createSupabaseAdminClient())
      : { isActive: false, message: DEFAULT_MAINTENANCE_MESSAGE };

  return (
    <main className="grid min-h-screen place-items-center bg-background px-4 py-16 text-foreground">
      <div className="w-full max-w-md text-center">
        <BrandMark className="mx-auto h-16 w-16" priority />
        <span className="mt-6 inline-grid h-12 w-12 place-items-center rounded-full bg-secondary text-muted-foreground">
          <Wrench className="h-5 w-5" aria-hidden="true" />
        </span>
        <h1 className="mt-4 text-2xl font-semibold tracking-tight">
          {state.isActive ? "We'll be right back" : "Everything is back online"}
        </h1>
        <p className="mt-3 text-sm leading-7 text-muted-foreground">
          {state.isActive ? state.message || DEFAULT_MAINTENANCE_MESSAGE : "Maintenance has finished. You can carry on."}
        </p>
        <p className="mt-6 text-xs text-muted-foreground">
          {state.isActive
            ? "Refresh this page to check whether we're done."
            : "Head back to your dashboard to pick up where you left off."}
        </p>
      </div>
    </main>
  );
}
