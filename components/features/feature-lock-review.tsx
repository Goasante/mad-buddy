"use client";

import { useState } from "react";
import { Link } from "@/lib/platform";
import { LOCKED_FEATURES, OPTIONAL_FEATURES, type OptionalFeature } from "@/lib/features/availability";
import { FeatureAvailabilityContext } from "./feature-availability-context";
import { LockedFeaturePreview } from "./locked-feature-preview";

export function FeatureLockReview() {
  const [feature, setFeature] = useState<OptionalFeature>("linkr");
  return <FeatureAvailabilityContext.Provider value={LOCKED_FEATURES}>
    <main className="mx-auto max-w-4xl space-y-5 p-4 sm:p-8">
      <h1 className="text-xl font-semibold">Feature lock visual review</h1>
      <p className="text-sm text-muted-foreground">Sample content only. This review page is unavailable in production.</p>
      <nav aria-label="Review feature" className="flex flex-wrap gap-2">
        {(Object.keys(OPTIONAL_FEATURES) as OptionalFeature[]).map(key => <button key={key} type="button" onClick={() => setFeature(key)} aria-pressed={feature === key} className="focus-ring rounded-full border border-border bg-secondary px-4 py-2 text-sm">{OPTIONAL_FEATURES[key].title}</button>)}
      </nav>
      <nav aria-label="Navigation lock samples" className="flex flex-wrap gap-4 text-sm">
        <Link href="/events">Events</Link>
        <Link href="/conference">Conference</Link>
        <Link href="/safe-arrival">Safe Arrival</Link>
        <Link href="/plans">Plans</Link>
        <Link href="/messages">Messages</Link>
        <Link href="/friends">Muddies</Link>
      </nav>
      <LockedFeaturePreview feature={feature} />
    </main>
  </FeatureAvailabilityContext.Provider>;
}
