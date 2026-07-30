"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type HorizontalPages = {
  scrollRef: React.RefObject<HTMLDivElement | null>;
  pageCount: number;
  activePage: number;
  goToPage: (page: number) => void;
};

/**
 * Measures a horizontal scroller and exposes real viewport-sized pages.
 * Dots are therefore rendered only when content actually overflows, rather
 * than being guessed from an item count that may fit differently by device.
 */
export function useHorizontalPages(itemCount = 0): HorizontalPages {
  const scrollRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<number | null>(null);
  const [pageCount, setPageCount] = useState(1);
  const [activePage, setActivePage] = useState(0);

  const measure = useCallback(() => {
    const element = scrollRef.current;
    if (!element) return;

    const viewport = Math.max(1, element.clientWidth);
    const overflow = Math.max(0, element.scrollWidth - viewport);
    const pages = overflow > 2 ? Math.ceil(element.scrollWidth / viewport) : 1;
    const current = pages === 1 ? 0 : Math.min(pages - 1, Math.round(element.scrollLeft / viewport));

    setPageCount(pages);
    setActivePage(current);
  }, []);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;

    const scheduleMeasure = () => {
      if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
      frameRef.current = window.requestAnimationFrame(measure);
    };

    scheduleMeasure();
    const observer = new ResizeObserver(scheduleMeasure);
    observer.observe(element);
    element.addEventListener("scroll", scheduleMeasure, { passive: true });
    window.addEventListener("orientationchange", scheduleMeasure);

    return () => {
      if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
      observer.disconnect();
      element.removeEventListener("scroll", scheduleMeasure);
      window.removeEventListener("orientationchange", scheduleMeasure);
    };
  }, [itemCount, measure]);

  const goToPage = useCallback((page: number) => {
    const element = scrollRef.current;
    if (!element) return;
    element.scrollTo({
      left: Math.max(0, Math.min(page, pageCount - 1)) * element.clientWidth,
      behavior: "smooth"
    });
  }, [pageCount]);

  return { scrollRef, pageCount, activePage, goToPage };
}
