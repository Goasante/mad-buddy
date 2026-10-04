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
    async function refresh() {
      try {
        const response = await fetch("/api/features/availability", { cache: "no-store" });
        const next = response.ok ? await response.json() as FeatureAvailability : { ...LOCKED_FEATURES };
        const changed = JSON.stringify(value) !== JSON.stringify(next);
        setValue(next);
        if (changed) router.refresh();
      } catch { setValue({ ...LOCKED_FEATURES }); }
    }
    const timer = window.setInterval(refresh, 30000);
    const onFocus = () => { void refresh(); };
    window.addEventListener("focus", onFocus);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", onFocus); };
  }, [router, value]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
