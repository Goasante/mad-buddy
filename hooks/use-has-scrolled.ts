"use client";

import { useEffect, useState } from "react";

/**
 * True once the page has scrolled far enough that content is passing under a
 * fixed header.
 *
 * Drives the header's divider and shadow, which stay off at rest so the header
 * reads as part of the page rather than a permanently stuck bar.
 *
 * Lifted out of MobilePageHeader so Linkr's own header uses the SAME threshold
 * and the same listener. Two copies would drift, and the visible symptom is
 * two headers in one app growing their dividers at different scroll offsets.
 */
export function useHasScrolled(threshold = 4): boolean {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const scrollOwner = document.querySelector<HTMLElement>("[data-app-scroll-owner]");
    const read = () => setScrolled((scrollOwner?.scrollTop ?? window.scrollY) > threshold);
    read();
    // Passive: this never calls preventDefault, and saying so keeps scrolling
    // off the main thread's critical path.
    const target: HTMLElement | Window = scrollOwner ?? window;
    target.addEventListener("scroll", read, { passive: true });
    return () => target.removeEventListener("scroll", read);
  }, [threshold]);

  return scrolled;
}
