import { UpgradePageContent } from "@/components/premium/upgrade-page";

// Renders per-user billing/onboarding state; never statically prerender
// (build environments have no Supabase secrets).
export const dynamic = "force-dynamic";

export default function UpgradePage() {
  return <UpgradePageContent />;
}
