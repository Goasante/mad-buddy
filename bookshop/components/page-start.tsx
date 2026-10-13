"use client";

import { useLayoutEffect } from "react";
import { usePathname } from "next/navigation";

export function PageStart() {
  const pathname = usePathname();
  useLayoutEffect(() => {
    // Leave in-page anchors alone; reset complete page changes immediately.
    if (!window.location.hash) {
      window.scrollTo({ top: 0, left: 0, behavior: "instant" });
    }
  }, [pathname]);
  return null;
}
