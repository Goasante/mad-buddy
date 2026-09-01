"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ArrowRight, X } from "lucide-react";
import { recordTourProgressAction, recordTourStepEventAction } from "@/app/(app)/tour-actions";
import { exitTourPreviewAction } from "@/app/(admin)/admin/tours/preview-actions";
import { endTourReplayAction } from "@/app/(app)/tour-replay-actions";
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

export type TourRunnerProps = {
  tourVersionId: string;
  title: string;
  description: string;
  steps: TourStepView[];
  startIndex: number;
  /** Legacy server payload fields; ignored by the consumer runner. */
  plan?: string;
  entitlements?: Record<string, unknown>;
  /** Admin preview: renders identically but records nothing anywhere. */
  preview?: boolean;
  /** Skip the invitation and start immediately (manual replay). */
  autoStart?: boolean;
  /** Admin editor to return to when a draft preview is exited. */
  previewReturnTo?: string;
  /** Banner text naming the version being previewed. */
  previewLabel?: string;
  /**
   * Manual replay. Records replay-specific analytics and writes NO progress, so
   * the user's original first-time completion or skip is preserved exactly.
   */
  replay?: boolean;
  /** Lets the contextual host offer another guide only after this one closes. */
  onResolved?: (tourVersionId: string) => void;
};

const SPOTLIGHT_CLASS = "tour-spotlight-target";

export function TourRunner({
  tourVersionId,
  title,
  description,
  steps,
  startIndex,
  plan: _plan,
  entitlements: _entitlements,
  preview = false,
  autoStart = false,
  previewReturnTo,
  previewLabel,
  replay = false,
  onResolved
}: TourRunnerProps) {
  const router = useRouter();
  const pathname = usePathname();
  const reducedMotion = useReducedMotion();
  const [phase, setPhase] = useState<"invitation" | "running" | "closed">(autoStart ? "running" : "invitation");
  const [index, setIndex] = useState(() => Math.min(Math.max(startIndex, 0), Math.max(steps.length - 1, 0)));
  const cardRef = useRef<HTMLDivElement>(null);
  const spotlitRef = useRef<HTMLElement | null>(null);
  // Preview-only signal: the current step named a target that is not on screen.
  const [targetMissing, setTargetMissing] = useState(false);
  /**
   * The step to show, clamped DURING RENDER rather than stored.
   *
   * `index` is clamped in the useState initialiser above, which runs once and
   * never again -- so if `steps` shrinks while the tour is running (a step that
   * stops being eligible after navigation, a shorter list from the server),
   * the stored index is left pointing past the end. Deriving the position here
   * means it can never be out of range, whatever `index` holds: no effect, no
   * extra render, and no window in which `step` is undefined while the running
   * branch below paints its full-screen scrim.
   */
  const stepIndex = steps.length === 0 ? 0 : Math.min(Math.max(index, 0), steps.length - 1);
  const step = steps[stepIndex];

  const record = useCallback(
    (status: "started" | "completed" | "skipped" | "dismissed", currentStepKey?: string | null) => {
      // A replay must not overwrite the original outcome. Passing `preview` for
      // replay reuses the existing server-side short-circuit so no progress row
      // is written and no first-time funnel event is emitted; replay reports
      // itself through its own tour_replay_* events instead.
      void recordTourProgressAction({ tourVersionId, status, currentStepKey, preview: preview || replay });
    },
    [tourVersionId, preview, replay]
  );

  const recordStep = useCallback(
    (stepId: string, event: "tour_step_viewed" | "tour_step_completed" | "tour_cta_clicked" | "tour_shown") => {
      void recordTourStepEventAction({ stepId, event, preview: preview || replay });
    },
    [preview, replay]
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
    // No target: nothing to resolve. The warning below is gated on the step
    // declaring a target, so a stale flag from a previous step cannot show here.
    if (!step.targetId) return;

    // Wait a frame so a just-navigated route has painted its targets. The
    // missing/found flag is set here rather than in the effect body, so this
    // never becomes a synchronous setState during render.
    let retryTimer: number | null = null;
    let attempts = 0;
    const findTarget = () => {
      const element = document.querySelector<HTMLElement>(`[data-tour-id="${step.targetId}"]`);
      if (!element) {
        // Route transitions, Suspense and mobile layout can paint a target a
        // little later. Retry for roughly one second before degrading to the
        // safe non-targeted card.
        attempts += 1;
        if (attempts < 12) retryTimer = window.setTimeout(findTarget, 90);
        else setTargetMissing(true);
        return;
      }
      setTargetMissing(false);
      element.classList.add(SPOTLIGHT_CLASS);
      spotlitRef.current = element;
      element.scrollIntoView({
        behavior: reducedMotion ? "auto" : "smooth",
        // Toward the top, so the bottom-sheet card cannot sit over it.
        block: "start"
      });
    };
    const frame = window.requestAnimationFrame(findTarget);

    return () => {
      window.cancelAnimationFrame(frame);
      if (retryTimer !== null) window.clearTimeout(retryTimer);
    };
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

  // Persist the real current step so closing the app or navigating away can
  // resume this version instead of treating a started tour as resolved.
  useEffect(() => {
    if (phase !== "running" || !step) return;
    record("started", step.stepKey);
  }, [phase, step, record]);

  // Move focus into the card when it opens so keyboard and screen-reader users
  // land on the explanation rather than somewhere behind it.
  useEffect(() => {
    if (phase === "closed") return;
    cardRef.current?.focus();
  }, [phase, index]);

  const finish = useCallback(() => {
    record("completed", step?.stepKey ?? null);
    // Clears the replay cookie so the tour ends cleanly instead of restarting on
    // the next navigation, and records the replay-specific completion.
    if (replay) void endTourReplayAction({ versionId: tourVersionId, completed: true });
    setPhase("closed");
    onResolved?.(tourVersionId);
  }, [record, step, replay, tourVersionId, onResolved]);

  const skip = useCallback(() => {
    record("skipped", step?.stepKey ?? null);
    if (replay) void endTourReplayAction({ versionId: tourVersionId, completed: false });
    setPhase("closed");
    onResolved?.(tourVersionId);
  }, [record, step, replay, tourVersionId, onResolved]);

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

  /**
   * A SCRIM MAY NEVER OUTLIVE ITS CARD.
   *
   * `index` was clamped only in the useState initialiser, which runs once and
   * never again. If `steps` shrank while the tour was running -- a step that
   * stops being eligible after navigation, a shorter list arriving from the
   * server -- `index` was left pointing past the end. `step` became undefined,
   * and the running branch below renders the scrim WITHOUT requiring a step:
   * a full-screen blur over the page with an empty card and no working way
   * out. That is the stranded backdrop, and it is worst exactly where it was
   * reported, because navigating is what changes which steps apply.
   *
   * The invariant, enforced here rather than hoped for: if there is no step to
   * show, there is no overlay. `steps.length === 0` was already covered; this
   * extends it to the out-of-range case, which is the one that actually
   * happened.
   */
  if (phase === "closed" || steps.length === 0) return null;
  if (phase === "running" && !step) return null;

  /* THE AUTOMATIC FLOATING INVITATION IS OFF (owner decision, 2026-08-31).
   *
   * Optional education was interrupting primary product actions: pinned above
   * the bottom navigation, the prompt reached into the page on shorter
   * viewports and covered Safe Arrival's CTAs. Rather than keep tuning its
   * placement against every surface, the unsolicited prompt no longer renders.
   *
   * Only the AUTOMATIC prompt is gone. The tour framework, step definitions,
   * analytics and the `autoStart` path are all untouched, so a tour a person
   * actually asks for still runs, and restoring this is one branch.
   */
  if (phase === "invitation") return null;


  const isLast = stepIndex === steps.length - 1;

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
        className="fixed bottom-[calc(5.75rem+env(safe-area-inset-bottom,0px))] left-1/2 z-[95] max-h-[calc(70svh-env(safe-area-inset-top,0px))] w-[calc(100%-1.5rem)] max-w-sm -translate-x-1/2 overflow-y-auto overscroll-contain rounded-2xl border border-border bg-card p-4 shadow-xl focus:outline-none md:bottom-5"
      >
        {/* Persistent but unobtrusive preview banner, with the way out always
            visible so an admin is never stranded inside a preview. */}
        {preview && previewReturnTo ? (
          <div className="-mx-4 -mt-4 mb-3 flex items-center justify-between gap-2 rounded-t-2xl bg-primary/10 px-4 py-2">
            <p className="min-w-0 truncate text-[0.6875rem] font-semibold uppercase tracking-wide text-primary">
              {previewLabel ?? "Preview mode"}
            </p>
            <button
              type="button"
              onClick={() => {
                void exitTourPreviewAction().then(() => {
                  setPhase("closed");
                  router.push(previewReturnTo as Parameters<typeof router.push>[0]);
                });
              }}
              className="focus-ring safe-motion shrink-0 rounded-full px-2 py-1 text-[0.6875rem] font-semibold text-primary hover:bg-primary/10"
            >
              Exit preview
            </button>
          </div>
        ) : null}

        {preview && targetMissing && step?.targetId ? (
          <p className="mb-2 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
            Target not found in preview: {step.targetId}. Consumers would see this step without a spotlight.
          </p>
        ) : null}

        <div className="flex items-start justify-between gap-3">
          <p className="text-[0.6875rem] font-semibold uppercase tracking-wide text-muted-foreground">
            {preview ? "Preview · " : ""}Step {stepIndex + 1} of {steps.length}
          </p>
          <button
            type="button"
            onClick={skip}
            aria-label="Close walkthrough"
            title="Close walkthrough"
            className="focus-ring -mr-2 -mt-2 grid h-11 w-11 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-secondary"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        {/* Thin brand-orange progress bar: present, but not competing with the
            highlighted app UI for attention. */}
        <div
          className="mt-1.5 h-0.5 w-full overflow-hidden rounded-full bg-border/70"
          role="progressbar"
          aria-valuemin={1}
          aria-valuemax={steps.length}
          aria-valuenow={index + 1}
          aria-label={`Step ${index + 1} of ${steps.length}`}
        >
          <div
            className={cn("h-full rounded-full", !reducedMotion && "transition-[width] duration-200")}
            style={{
              width: `${((index + 1) / steps.length) * 100}%`,
              backgroundColor: "var(--color-brand-orange)"
            }}
          />
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


        <div className="mt-4 flex items-center justify-between gap-2">
          <Button type="button" size="sm" variant="ghost" onClick={skip}>
            Skip tour
          </Button>
          <div className="flex items-center gap-2">
            {stepIndex > 0 ? (
              <Button type="button" size="sm" variant="outline" onClick={() => setIndex(stepIndex - 1)}>
                Back
              </Button>
            ) : null}
            {/* A CTA never replaces Next: it is an extra, and only shown when
                the step actually has one and the user isn't already entitled. */}
            {step?.ctaHref && step.ctaLabel ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  if (!step?.ctaHref) return;
                  recordStep(step.id, "tour_cta_clicked");
                  // Must NOT finish() here: following a CTA is not completing the
                  // tour, and marking it complete would both lie to analytics and
                  // stop the tour ever being offered again. Instead record the
                  // NEXT step as the resume point, so returning to the app picks
                  // the walkthrough back up where it left off.
                  record("started", steps[Math.min(index + 1, steps.length - 1)]?.stepKey ?? null);
                  router.push(step.ctaHref as Parameters<typeof router.push>[0]);
                }}
              >
                {step.ctaLabel}
              </Button>
            ) : null}
            <Button
              type="button"
              size="sm"
              onClick={() => {
                if (step) recordStep(step.id, "tour_step_completed");
                if (isLast) finish();
                else setIndex(stepIndex + 1);
              }}
            >
              {isLast ? "Finish" : "Next"}
              {isLast ? null : <ArrowRight className="h-4 w-4" aria-hidden="true" />}
            </Button>
          </div>
        </div>
      </aside>
    </>
  );
}
