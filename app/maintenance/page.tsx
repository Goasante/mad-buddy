import type { Metadata } from "next";
import Link from "next/link";
import { FailurePage } from "@/components/front-door/failure-page";
import { ensureMaintenanceWarm } from "@/lib/maintenance/loader";
import { DEFAULT_MAINTENANCE_MESSAGE } from "@/lib/maintenance/state";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSupabaseServerEnv } from "@/lib/supabase/env";

export const metadata: Metadata = {
  title: "Maintenance",
  description: "Mad Buddy is temporarily unavailable.",
  robots: { index: false, follow: false }
};

export const dynamic = "force-dynamic";

export default async function MaintenancePage() {
  const env = getSupabaseServerEnv();
  const state =
    env.url && env.serviceRoleKey
      ? await ensureMaintenanceWarm(createSupabaseAdminClient())
      : { isActive: false, message: DEFAULT_MAINTENANCE_MESSAGE };

  return (
    <FailurePage
      eyebrow={state.isActive ? "Maintenance" : "Service restored"}
      title={state.isActive ? "Mad Buddy is taking a short maintenance break." : "Mad Buddy is back online."}
      description={state.isActive ? state.message || DEFAULT_MAINTENANCE_MESSAGE : "Maintenance has finished. You can continue from where you left off."}
    >
      {state.isActive ? (
        <Link href="/maintenance" className="focus-ring inline-flex min-h-11 items-center justify-center rounded-full bg-[#4E0401] px-5 text-sm font-semibold text-white dark:bg-[#E88C2B] dark:text-[#2A120A]">
          Check again
        </Link>
      ) : (
        <Link href="/dashboard" className="focus-ring inline-flex min-h-11 items-center justify-center rounded-full bg-[#4E0401] px-5 text-sm font-semibold text-white dark:bg-[#E88C2B] dark:text-[#2A120A]">
          Open Mad Buddy
        </Link>
      )}
      <Link href="/support" className="focus-ring inline-flex min-h-11 items-center justify-center rounded-full border border-[#4E0401]/15 px-5 text-sm font-semibold text-[#4E0401] dark:border-white/15 dark:text-[#FFF8F1]">
        Support
      </Link>
    </FailurePage>
  );
}
