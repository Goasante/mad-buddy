"use client";

import type { Route } from "next";
import Image from "next/image";
import Link from "next/link";
import { ArrowRight, Check, Circle, LockKeyhole } from "lucide-react";
import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { JourneyGuideButton } from "@/components/journey/journey-guide-button";
import type { JourneyData, JourneyStep } from "@/lib/journey/journey";
import { cn } from "@/lib/utils";

export function JourneyProgress({ journey, variant = "full" }: { journey: JourneyData; variant?: "full" | "profile" | "home" }) {
  if (variant === "home") {
    if (!journey.currentStep) return null;
    return <JourneyHomeHero journey={journey} currentStep={journey.currentStep} />;
  }

  if (variant === "profile") {
    return <Card className="p-5"><div className="flex items-start justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Journey</p><p className="mt-1 text-lg font-semibold">{journey.currentStep?.title ?? "Journey complete"}</p><p className="mt-1 text-sm text-muted-foreground">{journey.completedCount} of {journey.totalCount} steps complete</p></div><span className="rounded-full bg-secondary/50 px-3 py-1 text-sm font-semibold tabular-nums">{journey.completedCount}/{journey.totalCount}</span></div><Link href="/buddy-score" className="focus-ring mt-4 inline-flex min-h-11 items-center gap-1.5 rounded-lg text-sm font-semibold text-primary">View My Progress <ArrowRight className="h-4 w-4" aria-hidden="true" /></Link></Card>;
  }

  return <div className="overflow-hidden rounded-2xl border border-border/70 bg-card/45">{journey.steps.map((step, index) => <div key={step.id} className={cn("flex gap-3 px-4 py-4 sm:px-5", index > 0 && "border-t border-border/60", step.state === "locked" && "text-muted-foreground")}><span className={cn("mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full border", step.state === "completed" ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-500" : step.state === "current" ? "border-primary/50 bg-primary/10 text-primary" : "border-border bg-secondary/25")} aria-hidden="true">{step.state === "completed" ? <Check className="h-4 w-4" /> : step.state === "current" ? <Circle className="h-3.5 w-3.5 fill-current" /> : <LockKeyhole className="h-3.5 w-3.5" />}</span><div className="min-w-0 flex-1"><div className="flex items-start justify-between gap-3"><div><p className="text-sm font-semibold text-foreground">{step.title}</p><p className="mt-1 text-sm leading-6 text-muted-foreground">{step.state === "locked" ? "Complete the previous step to continue." : step.description}</p>{step.state !== "locked" ? <p className="mt-1 text-xs text-muted-foreground">{step.unlockCondition}</p> : null}</div>{step.state === "completed" && step.guide ? <JourneyGuideButton tourVersionId={step.guide.tourVersionId} destination={step.destination} label={step.title} /> : null}</div>{step.state === "current" ? <Link href={step.destination as Route} className="focus-ring mt-3 inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground">Continue <ArrowRight className="h-4 w-4" aria-hidden="true" /></Link> : null}</div></div>)}</div>;
}

/**
 * Home's Journey hero. Framed as a reward worth earning rather than a
 * progress tracker: the step title and the benefit of finishing it lead,
 * progress is compressed to one "N% Complete / M steps remaining" pair
 * (the old card said the same thing twice), and the CTA names the reward
 * instead of the mechanic.
 *
 * Copy is driven entirely by real journey state — this card renders
 * whichever step is current, so nothing here hardcodes Trusted Buddy
 * language that would read as nonsense on the other nine steps.
 *
 * The progress bar fills from 0 on mount via a real state transition (a
 * plain CSS transition would race its own initial value and never animate)
 * — that's the one reason this needs local state.
 */
function JourneyHomeHero({ journey, currentStep }: { journey: JourneyData; currentStep: JourneyStep }) {
  const percent = journey.totalCount > 0 ? Math.round((journey.completedCount / journey.totalCount) * 100) : 0;
  const [animatedPercent, setAnimatedPercent] = useState(0);

  useEffect(() => {
    const frame = requestAnimationFrame(() => setAnimatedPercent(percent));
    return () => cancelAnimationFrame(frame);
  }, [percent]);

  const remaining = Math.max(0, journey.totalCount - journey.completedCount);
  const remainingLabel = remaining === 1 ? "One step remaining" : `${remaining} steps remaining`;

  return (
    <Link
      href={currentStep.destination as Route}
      aria-label={`${currentStep.title}. ${percent}% complete, ${remainingLabel.toLowerCase()}.`}
      className="focus-ring safe-motion group relative block overflow-hidden rounded-[1.75rem] bg-[linear-gradient(118deg,#9d1268_0%,#b81a5c_32%,#cc2f44_60%,#d9482c_100%)] px-5 pb-5 pt-5 shadow-[0_10px_30px_hsl(var(--shadow)/0.18)] transition-transform duration-200 ease-out active:scale-[0.99] motion-reduce:active:scale-100"
    >
      {/* Self-contained cut-out illustration (feathered alpha edges) sitting
          ON the gradient. Pushed right and below centre so it reads as a
          background accent rather than competing with the text column, and
          held at a lower opacity so any overlap with the copy stays quiet.
          The soft radial glow behind it adds depth without a hard edge. */}
      <div
        className="pointer-events-none absolute -right-12 top-[66%] h-[10.5rem] w-[10.5rem] -translate-y-1/2 opacity-90"
        aria-hidden="true"
      >
        <span className="journey-target-glow absolute inset-[12%] rounded-full bg-white/25 blur-2xl" />
        <Image
          src="/brand/journey-target.webp"
          alt=""
          fill
          priority
          sizes="168px"
          className="journey-hero-artwork relative object-contain"
        />
      </div>

      {/* Text column stays well clear of the illustration so a two-line
          title can never collide with it. */}
      {/* The title opens the card. The "CONTINUE YOUR JOURNEY" eyebrow that
          used to sit here is gone — the card sits directly under Welcome, so
          the label restated context the position already gave, and cost ~20px
          above the fold. */}
      <div className="relative z-[1] max-w-[58%]">
        <p className="text-[1.375rem] font-bold leading-[1.15] text-white">{currentStep.title}</p>
        {/* Solid white, not white/90 — at this size the alpha variant measured
            4.23:1 against the gradient, just under the 4.5:1 AA floor. Kept
            lighter in weight than the title so the two do not compete. */}
        <p className="mt-2 text-[0.8125rem] font-normal leading-[1.45] text-white">{currentStep.description}</p>
      </div>

      {/* Progress + CTA run the full card width — below the illustration, so
          they get the whole measure rather than being squeezed beside it.
          Labels stack rather than sharing a line, so a longer future state
          ("3 steps remaining", a paused or completed state) can extend
          without reflowing the row or colliding with the percentage. */}
      {/* Progress + CTA. Typography steps down deliberately: the percentage
          is the anchor, the remaining-steps line is supporting text at lower
          emphasis, and the CTA re-asserts as the action. */}
      <div className="relative z-[1] mt-5">
        <p className="text-[0.9375rem] font-semibold tabular-nums text-white">{percent}% Complete</p>
        {/* white/85 rather than solid: this is supporting text and should
            recede. Still clears AA at this size against the gradient's dark
            left end, which is where the text column sits. */}
        <p className="mt-0.5 text-xs font-normal text-white/85">{remainingLabel}</p>
        {/* 70% of the card, keeping the bar clear of the illustration. */}
        <div className="mt-2.5 h-[0.375rem] w-[70%] overflow-hidden rounded-full bg-white/20">
          <div
            className="h-full origin-left rounded-full bg-[#ffc247] shadow-[0_0_10px_rgba(255,194,71,0.5)] transition-transform duration-[900ms] ease-out motion-reduce:duration-0"
            style={{ transform: `scaleX(${animatedPercent / 100})` }}
          />
        </div>

        {/* White, not amber: amber on this gradient measured ~2.2:1, well
            below the 4.5:1 AA floor. White clears it at every point the CTA
            can sit. Amber survives as the progress fill, where it is
            decorative and carries no text.

            One fixed label across every step — the card should read the same
            whichever canonical state drives it, so no per-step CTA copy. */}
        <span className="mt-4 inline-flex items-center gap-2 text-[0.9375rem] font-bold text-white">
          Continue Journey
          <ArrowRight className="journey-cta-arrow h-[1.05rem] w-[1.05rem]" aria-hidden="true" />
        </span>
      </div>
    </Link>
  );
}
