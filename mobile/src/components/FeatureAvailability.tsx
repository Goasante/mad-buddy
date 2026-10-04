import { useEffect, useState, type ReactNode } from "react";
import { FeatureAvailabilityContext, useFeatureAvailability } from "@/components/features/feature-availability-context";
import { LockedFeaturePreview } from "@/components/features/locked-feature-preview";
import { LOCKED_FEATURES, type FeatureAvailability, type OptionalFeature } from "@/lib/features/availability";
import { api } from "../lib/api";
export function MobileFeatureAvailabilityProvider({ children }: { children: ReactNode }) {
  const [availability, setAvailability] = useState<FeatureAvailability>({ ...LOCKED_FEATURES });
  useEffect(() => {
    let active = true;
    let latestRequest = 0;
    async function refresh() {
      const requestId = ++latestRequest;
      const result = await api.get<FeatureAvailability>("/api/features/availability");
      if (active && requestId === latestRequest) setAvailability(result.ok ? result.data : { ...LOCKED_FEATURES });
    }
    void refresh();
    const timer = window.setInterval(refresh, 30000);
    const onFocus = () => { void refresh(); };
    window.addEventListener("focus", onFocus);
    return () => { active = false; window.clearInterval(timer); window.removeEventListener("focus", onFocus); };
  }, []);
  return <FeatureAvailabilityContext.Provider value={availability}>{children}</FeatureAvailabilityContext.Provider>;
}
export function MobileFeatureBoundary({ feature, children }: { feature: OptionalFeature; children: ReactNode }) {
  const availability = useFeatureAvailability();
  return availability?.[feature] ? children : <LockedFeaturePreview feature={feature} />;
}
