"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ArrowRight, X } from "lucide-react";
import { recordTourProgressAction, recordTourStepEventAction } from "@/app/(app)/tour-actions";
import { exitTourPreviewAction } from "@/app/(admin)/admin/tours/preview-actions";
import { endTourReplayAction } from "@/app/(app)/tour-replay-actions";
import { BrandMark } from "@/components/brand/brand-mark";
import { Button } from "@/components/ui/button";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { cn } from "@/lib/utils";
import { cheapestPaidPrice, planPrice } from "@/lib/billing/upgrade-copy";
import { PLAN_BILLING_INTERVAL } from "@/lib/billing/pricing";

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
  /** Admin editor to return to when a draft preview is exited. */
  previewReturnTo?: string;
  /** Banner text naming the version being previewed. */
  previewLabel?: string;
  /**
   * Manual replay. Records replay-specific analytics and writes NO progress, so
   * the user's original first-time completion or skip is preserved exactly.
   */
  replay?: boolean;
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
  autoStart = false,
  previewReturnTo,
  previewLabel,
  replay = false
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
  const step = steps[index];

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
    (stepId: string, event: "tour_step_viewed" | "tour_cta_clicked" | "tour_shown") => {
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
    const frame = window.requestAnimationFrame(() => {
      const element = document.querySelector<HTMLElement>(`[data-tour-id="${step.targetId}"]`);
      if (!element) {
        // Absent target: plain card, no failure. Consumers see nothing unusual;
        // in preview an admin gets told, because a typo'd target would
        // otherwise look like a working step.
        setTargetMissing(true);
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
    // Clears the replay cookie so the tour ends cleanly instead of restarting on
    // the next navigation, and records the replay-specific completion.
    if (replay) void endTourReplayAction({ versionId: tourVersionId, completed: true });
    setPhase("closed");
  }, [record, step, replay, tourVersionId]);

  const skip = useCallback(() => {
    record("skipped", step?.stepKey ?? null);
    if (replay) void endTourReplayAction({ versionId: tourVersionId, completed: false });
    setPhase("closed");
  }, [record, step, replay, tourVersionId]);

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
        {/* The brand mark, not a generic sparkle: the first thing a user sees of
            the walkthrough should read as Mad Buddy. */}
        <p id="tour-invite-title" className="flex items-center gap-2 text-sm font-semibold">
          <BrandMark className="h-5 w-5 shrink-0" />
          {title}
        </p>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          {description ||
            "Take a quick tour of how to find nearby Muddies, connect, make plans, and stay in control of your privacy."}
        </p>
        <div className="mt-3 flex justify-end gap-2">
          {/* "Not now" before the tour has begun; "Skip tour" only applies once
              the user is actually inside it. */}
          <Button type="button" size="sm" variant="ghost" onClick={skip}>
            Not now
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => {
              record("started", steps[index]?.stepKey ?? null);
              setPhase("running");
            }}
          >
            Take the tour
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
            {preview ? "Preview · " : ""}Step {index + 1} of {steps.length}
          </p>
          <button
            type="button"
            onClick={skip}
            aria-label="Skip tour"
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

        {stepEntitlements.length > 0 ? (
          // Subscription education. Deliberately a distinct, more substantial
          // presentation than an ordinary feature step, because this is the ONE
          // place tiers are explained: every other step is about a feature and
          // carries no entitlement keys at all.
          //
          // Laid out as one stacked block PER PLAN rather than a four-column
          // grid. The grid squeezed feature names into fragments like
          // "Max active han...", which tells a user nothing; a full-width row
          // per plan keeps every label readable down to 320px.
          //
          // Prices come from the canonical display-price source and per-plan
          // values from the entitlement registry resolved on the server, so this
          // can never disagree with Pricing or Plan and Billing.
          <div className="mt-3 space-y-2">
            {(
              [
                { key: "free", label: "Free", promise: "Everything you need to start" },
                { key: "buddy_plus", label: "Buddy Plus", promise: "More room to connect" },
                { key: "buddy_pro", label: "Buddy Pro", promise: "The full Mad Buddy experience" }
              ] as const
            ).map((tier) => {
              const isCurrent = plan === tier.key;
              return (
                <div
                  key={tier.key}
                  className={cn(
                    "rounded-xl border p-2.5",
                    isCurrent ? "border-2 bg-primary/[0.06]" : "border-border/70",
                    // Paid tiers carry a little more presence, but Free is never
                    // styled as lesser: it stays a legitimate choice.
                    tier.key !== "free" && !isCurrent && "bg-secondary/30"
                  )}
                  style={isCurrent ? { borderColor: "var(--color-brand-orange)" } : undefined}
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="min-w-0 text-xs font-semibold">{tier.label}</p>
                    {isCurrent ? (
                      <p
                        className="shrink-0 text-[0.5625rem] font-bold uppercase tracking-wide"
                        style={{ color: "var(--color-brand-orange)" }}
                      >
                        Your plan
                      </p>
                    ) : (
                      <p className="shrink-0 text-[0.6875rem] font-semibold tabular-nums text-muted-foreground">
                        {planPrice(tier.key)}
                      </p>
                    )}
                  </div>
                  <p className="mt-0.5 text-[0.6875rem] leading-4 text-muted-foreground">{tier.promise}</p>

                  {/* Full-width label + value rows: nothing truncates. */}
                  <dl className="mt-2 space-y-1">
                    {stepEntitlements.map((entry) => (
                      <div key={entry.key} className="flex items-baseline justify-between gap-3">
                        <dt className="min-w-0 text-[0.6875rem] leading-4 text-muted-foreground">{entry.label}</dt>
                        <dd className="shrink-0 text-[0.6875rem] font-medium tabular-nums">
                          {tier.key === "free" ? entry.free : tier.key === "buddy_plus" ? entry.buddyPlus : entry.buddyPro}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </div>
              );
            })}

            <p className="text-[0.6875rem] leading-5 text-muted-foreground">
              {plan === "buddy_pro"
                ? "You're on Buddy Pro, so you already have the full Mad Buddy experience, including publishing to Spotlight."
                : `Nothing to decide now. Upgrade from as low as ${cheapestPaidPrice()} a ${PLAN_BILLING_INTERVAL} whenever you like.`}
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
            <Button type="button" size="sm" onClick={() => (isLast ? finish() : setIndex((value) => value + 1))}>
              {isLast ? "Done" : "Next"}
              {isLast ? null : <ArrowRight className="h-4 w-4" aria-hidden="true" />}
            </Button>
          </div>
        </div>
      </aside>
    </>
  );
}
