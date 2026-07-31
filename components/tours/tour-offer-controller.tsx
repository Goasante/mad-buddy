"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { TourRunner } from "@/components/tours/tour-runner";
import { FEATURE_GUIDES } from "@/lib/tours/registry";
import { selectContextualTour } from "@/lib/tours/context";

export type ContextualTourOffer = {
  tourVersionId: string;
  slug: string;
  title: string;
  description: string;
  steps: Array<{
    id: string;
    stepKey: string;
    title: string;
    body: string;
    targetId: string | null;
    route: string | null;
    mediaPath: string | null;
    ctaLabel: string | null;
    ctaHref: string | null;
    entitlementKeys: string[];
  }>;
  startIndex: number;
  plan: "free" | "buddy_plus" | "buddy_pro";
  entitlements: Record<
    string,
    { key: string; label: string; free: string; buddyPlus: string; buddyPro: string; current: string }
  >;
  progressStatus: "started" | "completed" | "skipped" | "dismissed" | null;
};

function blockingInterfaceIsOpen(): boolean {
  if (typeof document === "undefined") return true;
  const modalIsOpen = [...document.querySelectorAll<HTMLElement>('[role="dialog"]')].some(
    (element) => element.getAttribute("aria-modal") !== "false"
  );
  if (modalIsOpen) return true;

  const activeElement = document.activeElement;
  return (
    activeElement instanceof HTMLInputElement ||
    activeElement instanceof HTMLTextAreaElement ||
    activeElement instanceof HTMLSelectElement ||
    (activeElement instanceof HTMLElement &&
      (activeElement.isContentEditable || activeElement.getAttribute("role") === "textbox"))
  );
}

function activeTargetIsSelected(targetId: string): boolean {
  if (typeof document === "undefined") return false;
  const target = document.querySelector<HTMLElement>(`[data-tour-id="${targetId}"]`);
  return target?.getAttribute("aria-selected") === "true" || target?.dataset.tourActive === "true";
}

/**
 * Chooses from server-authorised unresolved tours using only current UI context.
 * Eligibility, plan, flags, and progress remain server-authoritative; pathname
 * and selected tabs merely decide WHEN the already-approved guide is relevant.
 */
export function TourOfferController({ tours }: { tours: ContextualTourOffer[] }) {
  const pathname = usePathname();
  const [resolvedIds, setResolvedIds] = useState<Set<string>>(() => new Set());
  const [activeTourId, setActiveTourId] = useState<string | null>(null);
  const suppressedPathRef = useRef<string | null>(null);

  useEffect(() => {
    if (activeTourId) return;
    let timer: number | null = null;
    const inspect = () => {
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (suppressedPathRef.current && suppressedPathRef.current !== pathname) {
          suppressedPathRef.current = null;
        }
        if (blockingInterfaceIsOpen() || suppressedPathRef.current === pathname) return;
        const activeTargetIds = new Set(
          FEATURE_GUIDES.map((guide) => guide.activeTargetId).filter(
            (targetId): targetId is NonNullable<typeof targetId> =>
              Boolean(targetId && activeTargetIsSelected(targetId))
          )
        );
        const choice = selectContextualTour({ tours, pathname, activeTargetIds, resolvedIds });
        if (choice) setActiveTourId(choice.tourVersionId);
      }, 350);
    };

    inspect();
    const observer = new MutationObserver(inspect);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["aria-selected", "aria-modal", "data-tour-active"]
    });
    document.addEventListener("focusin", inspect);
    document.addEventListener("focusout", inspect);

    return () => {
      observer.disconnect();
      document.removeEventListener("focusin", inspect);
      document.removeEventListener("focusout", inspect);
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [activeTourId, pathname, resolvedIds, tours]);

  const chosen = useMemo(
    () => tours.find((tour) => tour.tourVersionId === activeTourId) ?? null,
    [activeTourId, tours]
  );

  const resolveLocally = useCallback(
    (tourVersionId: string) => {
      setResolvedIds((current) => new Set(current).add(tourVersionId));
      setActiveTourId(null);
      // Do not immediately chain another guide on the route where this one
      // ended. Leaving the route clears this suppression, so a later visit can
      // still offer another contextual guide such as Air after Moments.
      suppressedPathRef.current = pathname;
    },
    [pathname]
  );

  if (!chosen) return null;

  return (
    <TourRunner
      key={chosen.tourVersionId}
      tourVersionId={chosen.tourVersionId}
      title={chosen.title}
      description={chosen.description}
      steps={chosen.steps}
      startIndex={chosen.startIndex}
      plan={chosen.plan}
      entitlements={chosen.entitlements}
      autoStart={chosen.progressStatus === "started"}
      onResolved={resolveLocally}
    />
  );
}
