"use client";

import { useEffect } from "react";

export function PricingViewTracker() {
  useEffect(() => {
    void fetch("/api/analytics/pricing-view", { method: "POST", keepalive: true });
  }, []);
  return null;
}

