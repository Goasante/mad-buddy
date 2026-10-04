"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { LOCKED_FEATURES, type FeatureAvailability } from "@/lib/features/availability";
import { FeatureAvailabilityContext as Context } from "./feature-availability-context";
export function FeatureAvailabilityProvider({ initial, children }: { initial: FeatureAvailability; children: ReactNode }) {
  const router = useRouter();
  const [value, setValue] = useState(initial);
  const [previousInitial, setPreviousInitial] = useState(initial);
  if (previousInitial !== initial) {
    setPreviousInitial(initial);
    setValue(initial);
  }
  useEffect(() => {
    let active = true;
    let latestRequest = 0;
    async function refresh() {
      const requestId = ++latestRequest;
      try {
        const response = await fetch("/api/features/availability", { cache: "no-store" });
        const next = response.ok ? await response.json() as FeatureAvailability : { ...LOCKED_FEATURES };
        if (!active || requestId !== latestRequest) return;
        const changed = JSON.stringify(value) !== JSON.stringify(next);
        if (changed) { setValue(next); router.refresh(); }
      } catch {
        if (active && requestId === latestRequest) { setValue({ ...LOCKED_FEATURES }); router.refresh(); }
      }
    }
    const timer = window.setInterval(refresh, 30000);
    const onFocus = () => { void refresh(); };
    window.addEventListener("focus", onFocus);
    return () => { active = false; window.clearInterval(timer); window.removeEventListener("focus", onFocus); };
  }, [router, value]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
