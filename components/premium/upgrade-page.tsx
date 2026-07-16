import Link from "next/link";
import { ArrowLeft, Crown } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { LockedFeatureCard } from "@/components/premium/locked-feature-card";
import { PlanComparisonTable } from "@/components/premium/plan-comparison-table";

const lockedFeatures = [
  {
    title: "Best Buddies priority",
    description: "Mark important friends so their glow and alerts stand out first.",
    requiredPlan: "Buddy Plus"
  },
  {
    title: "Smart nearby alerts",
    description: "Get stronger, more useful nudges for approved friends without exact location.",
    requiredPlan: "Buddy Plus"
  },
  {
    title: "Privacy Zones",
    description: "Automatically keep your glow quiet in sensitive places like home or work.",
    requiredPlan: "Buddy Pro"
  },
  {
    title: "Muddy Circles",
    description: "Control visibility by group, such as close friends, gym crew, or events.",
    requiredPlan: "Buddy Pro"
  }
];

export function UpgradePageContent() {
  return (
    <div className="space-y-6">
      <section className="glass-panel rounded-[1.25rem] p-5 sm:p-6">
        <Button type="button" variant="ghost" size="sm" asChild>
          <Link href="/dashboard">
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Back
          </Link>
        </Button>
        <Badge variant="violet" className="mt-5">
          <Crown className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
          Upgrade
        </Badge>
        <h1 className="mt-4 text-3xl font-semibold sm:text-4xl">Unlock the parts that make Mad Buddy feel alive.</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
          Plus makes friend presence richer. Pro adds serious privacy control when you need stronger boundaries.
        </p>
      </section>
      <section className="grid gap-4 lg:grid-cols-3">
        {lockedFeatures.map((feature) => (
          <LockedFeatureCard key={feature.title} {...feature} />
        ))}
      </section>
      <section className="glass-panel rounded-[1.25rem] p-5">
        <h2 className="mb-5 text-xl font-semibold">Compare plans</h2>
        <PlanComparisonTable />
      </section>
    </div>
  );
}
