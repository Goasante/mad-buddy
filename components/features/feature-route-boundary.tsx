"use client";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { featureForHref } from "@/lib/features/availability";
import { useFeatureAvailability } from "./feature-availability-context";
import { LockedFeaturePreview } from "./locked-feature-preview";
export function FeatureRouteBoundary({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const availability = useFeatureAvailability();
  const feature = featureForHref(pathname);
  // Safe Arrival's server page owns the active-journey drain exception.
  if (feature && feature !== "safe_arrival" && availability && !availability[feature]) return <LockedFeaturePreview feature={feature} />;
  return children;
}
