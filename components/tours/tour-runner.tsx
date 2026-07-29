"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ArrowRight, Sparkles, X } from "lucide-react";
import { recordTourProgressAction, recordTourStepEventAction } from "@/app/(app)/tour-actions";
import { Button } from "@/components/ui/button";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { cn } from "@/lib/utils";

/**
 * The guided-tour engine.
 *
 * Deliberate design choices:
 *  * The step card is a bottom sheet, not a floating popover anchored to the
 *    target. Highlighted elements are scrolled toward the top of the viewport
 *    instead, so the card can never cover the thing it is describing and there
 *    is no edge-collision/flip maths to get wrong at 320px.
 *  * A missing target is not an error. If a step's element is absent (hidden by
 *    a responsive layout, an entitlement, or a race with a route change) the
 *    step still renders as a plain card. The tour never breaks.
 *  * All progress writes are fire-and-forget. Feature education must not be able
 *    to fail or block the app it is explaining.
 */

type TourStepView = {
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
};

type ResolvedEntitlementView = {
  key: string;
  label: string;
  free: string;
  buddyPlus: string;
  buddyPro: string;
  current: string;
};

export type TourRunnerProps = {
  tourVersionId: string;
  title: string;
  description: string;
  steps: TourStepView[];
  startIndex: number;
  plan: "free" | "buddy_plus" | "buddy_pro";
  entitlements: Record<string, ResolvedEntitlementView>;
  /** Admin preview: renders identically but records nothing anywhere. */
  preview?: boolean;
  /** Skip the invitation and start immediately (manual replay). */
  autoStart?: boolean;
};

const SPOTLIGHT_CLASS = "tour-spotlight-target";

export function TourRunner({
  tourVersionId,
  title,
  description,
  steps,
  startIndex,
  plan,
  entitlements,
  preview = false,
  autoStart = false
}: TourRunnerProps) {
  const router = useRouter();
  const pathname = usePathname();
  const reducedMotion = useReducedMotion();
  const [phase, setPhase] = useState<"invitation" | "running" | "closed">(autoStart ? "running" : "invitation");
  const [index, setIndex] = useState(() => Math.min(Math.max(startIndex, 0), Math.max(steps.length - 1, 0)));
  const cardRef = useRef<HTMLDivElement>(null);
  const spotlitRef = useRef<HTMLElement | null>(null);
  const step = steps[index];

  const record = useCallback(
    (status: "started" | "completed" | "skipped" | "dismissed", currentStepKey?: string | null) => {
      void recordTourProgressAction({ tourVersionId, status, currentStepKey, preview });
    },
    [tourVersionId, preview]
  );

  const recordStep = useCallback(
    (stepId: string, event: "tour_step_viewed" | "tour_cta_clicked" | "tour_shown") => {
      void recordTourStepEventAction({ stepId, event, preview });
    },
    [preview]
  );

  // The invitation itself is a measurable impression (brief §22).
  useEffect(() => {
    if (phase === "invitation" && steps[0]) recordStep(steps[0].id, "tour_shown");
  }, [phase, steps, recordStep]);

  // Spotlight the current step's target, and clean the class off the previous
  // one. Kept in a ref rather than derived state because the element belongs to
  // the page, not to this component.
  useEffect(() => {
    if (phase !== "running" || !step) return;

    if (spotlitRef.current) {
      spotlitRef.current.classList.remove(SPOTLIGHT_CLASS);
      spotlitRef.current = null;
    }
    if (!step.targetId) return;

    // Wait a frame so a just-navigated route has painted its targets.
    const frame = window.requestAnimationFrame(() => {
      const element = document.querySelector<HTMLElement>(`[data-tour-id="${step.targetId}"]`);
      if (!element) return; // Absent target: plain card, no failure.
      element.classList.add(SPOTLIGHT_CLASS);
      spotlitRef.current = element;
      element.scrollIntoView({
        behavior: reducedMotion ? "auto" : "smooth",
        // Toward the top, so the bottom-sheet card cannot sit over it.
        block: "start"
      });
    });

    return () => window.cancelAnimationFrame(frame);
  }, [phase, step, pathname, reducedMotion]);

  // Always strip the spotlight when the tour goes away.
  useEffect(
    () => () => {
      spotlitRef.current?.classList.remove(SPOTLIGHT_CLASS);
      spotlitRef.current = null;
    },
    []
  );

  // Route-aware steps: navigate before showing, and let the effect above
  // re-run on the new pathname to find the target.
  useEffect(() => {
    if (phase !== "running" || !step?.route) return;
    if (pathname === step.route) return;
    router.push(step.route as Parameters<typeof router.push>[0]);
  }, [phase, step, pathname, router]);

  useEffect(() => {
    if (phase !== "running" || !step) return;
    recordStep(step.id, "tour_step_viewed");
  }, [phase, step, recordStep]);

  // Move focus into the card when it opens so keyboard and screen-reader users
  // land on the explanation rather than somewhere behind it.
  useEffect(() => {
    if (phase === "closed") return;
    cardRef.current?.focus();
  }, [phase, index]);

  const finish = useCallback(() => {
    record("completed", step?.stepKey ?? null);
    setPhase("closed");
  }, [record, step]);

  const skip = useCallback(() => {
    record("skipped", step?.stepKey ?? null);
    setPhase("closed");
  }, [record, step]);

  // Escape dismisses the tour — it is never a blocking, unescapable layer.
  useEffect(() => {
    if (phase === "closed") return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        skip();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [phase, skip]);

  if (phase === "closed" || steps.length === 0) return null;

  if (phase === "invitation") {
    return (
      <aside
        ref={cardRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="false"
        aria-labelledby="tour-invite-title"
        className="fixed bottom-[calc(5.75rem+env(safe-area-inset-bottom,0px))] left-1/2 z-[95] w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 rounded-2xl border border-border bg-card p-4 shadow-xl focus:outline-none md:bottom-5"
      >
        <p id="tour-invite-title" className="flex items-center gap-2 text-sm font-semibold">
          <Sparkles className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
          {title}
        </p>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          {description || `A quick look at how Mad Buddy works — about ${Math.max(1, Math.round(steps.length / 6))} min.`}
        </p>
        <div className="mt-3 flex justify-end gap-2">
          <Button type="button" size="sm" variant="ghost" onClick={skip}>
            Skip
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => {
              record("started", steps[index]?.stepKey ?? null);
              setPhase("running");
            }}
          >
            Show me
          </Button>
        </div>
      </aside>
    );
  }

  const isLast = index === steps.length - 1;
  const stepEntitlements = (step?.entitlementKeys ?? [])
    .map((key) => entitlements[key])
    .filter((entry): entry is ResolvedEntitlementView => Boolean(entry));

  return (
    <>
      {/* Scrim: dims the page but stays pointer-transparent so the highlighted
          element underneath is still visible in context (brief §9). */}
      <div
        className={cn("pointer-events-none fixed inset-0 z-[94] bg-background/45", !reducedMotion && "backdrop-blur-[1px]")}
        aria-hidden="true"
      />
      <aside
        ref={cardRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="false"
        aria-labelledby="tour-step-title"
        aria-describedby="tour-step-body"
        className="fixed bottom-[calc(5.75rem+env(safe-area-inset-bottom,0px))] left-1/2 z-[95] max-h-[70svh] w-[calc(100%-1.5rem)] max-w-sm -translate-x-1/2 overflow-y-auto overscroll-contain rounded-2xl border border-border bg-card p-4 shadow-xl focus:outline-none md:bottom-5"
      >
        <div className="flex items-start justify-between gap-3">
          <p className="text-[0.6875rem] font-semibold uppercase tracking-wide text-muted-foreground">
            {preview ? "Preview · " : ""}Step {index + 1} of {steps.length}
          </p>
          <button
            type="button"
            onClick={skip}
            aria-label="Skip tour"
            className="focus-ring -mr-1 -mt-1 grid h-8 w-8 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-secondary"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <h2 id="tour-step-title" className="mt-1 text-base font-semibold">
          {step?.title}
        </h2>
        <p id="tour-step-body" className="mt-1.5 text-sm leading-6 text-muted-foreground">
          {step?.body}
        </p>

        {step?.mediaPath ? (
          // Lazy + explicit ratio: tour media is never preloaded globally and
          // never shifts layout as it arrives.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={step.mediaPath}
            alt=""
            loading="lazy"
            decoding="async"
            className="mt-3 aspect-[9/16] max-h-56 w-full rounded-xl border border-border/70 object-cover object-top"
          />
        ) : null}

        {stepEntitlements.length > 0 ? (
          <div className="mt-3 overflow-hidden rounded-xl border border-border/70">
            <div className="grid grid-cols-4 gap-2 bg-secondary/50 px-3 py-2 text-[0.625rem] font-semibold uppercase tracking-wide text-muted-foreground">
              <span className="col-span-1">Plan</span>
              <span>Free</span>
              <span>Plus</span>
              <span>Pro</span>
            </div>
            {stepEntitlements.map((entry) => (
              <div key={entry.key} className="grid grid-cols-4 gap-2 border-t border-border/60 px-3 py-2 text-xs">
                <span className="col-span-1 min-w-0 truncate text-muted-foreground">{entry.label}</span>
                <span className={cn("tabular-nums", plan === "free" && "font-semibold text-foreground")}>{entry.free}</span>
                <span className={cn("tabular-nums", plan === "buddy_plus" && "font-semibold text-foreground")}>
                  {entry.buddyPlus}
                </span>
                <span className={cn("tabular-nums", plan === "buddy_pro" && "font-semibold text-foreground")}>
                  {entry.buddyPro}
                </span>
              </div>
            ))}
            <p className="border-t border-border/60 px-3 py-2 text-[0.6875rem] text-muted-foreground">
              {plan === "buddy_pro"
                ? "You're on Buddy Pro — you already have the highest limits."
                : "Your current plan is highlighted."}
            </p>
          </div>
        ) : null}

        <div className="mt-4 flex items-center justify-between gap-2">
          <Button type="button" size="sm" variant="ghost" onClick={skip}>
            Skip tour
          </Button>
          <div className="flex items-center gap-2">
            {index > 0 ? (
              <Button type="button" size="sm" variant="outline" onClick={() => setIndex((value) => value - 1)}>
                Back
              </Button>
            ) : null}
            {/* A CTA never replaces Next: it is an extra, and only shown when
                the step actually has one and the user isn't already entitled. */}
            {step?.ctaHref && step.ctaLabel && plan !== "buddy_pro" ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  if (step) recordStep(step.id, "tour_cta_clicked");
                  finish();
                  router.push(step.ctaHref as Parameters<typeof router.push>[0]);
                }}
              >
                {step.ctaLabel}
              </Button>
            ) : null}
            <Button type="button" size="sm" onClick={() => (isLast ? finish() : setIndex((value) => value + 1))}>
              {isLast ? "Finish" : "Next"}
              {isLast ? null : <ArrowRight className="h-4 w-4" aria-hidden="true" />}
            </Button>
          </div>
        </div>
      </aside>
    </>
  );
}
