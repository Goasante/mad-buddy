import { OnboardingFlow } from "@/components/onboarding/onboarding-flow";

// Renders per-user billing/onboarding state; never statically prerender
// (build environments have no Supabase secrets).
export const dynamic = "force-dynamic";

export default function OnboardingPage() {
  return <OnboardingFlow />;
}
