import type { Route } from "next";
import Link from "next/link";
import { ArrowRight, Check, Circle, LockKeyhole } from "lucide-react";
import { Card } from "@/components/ui/card";
import { JourneyGuideButton } from "@/components/journey/journey-guide-button";
import type { JourneyData } from "@/lib/journey/journey";
import { cn } from "@/lib/utils";

export function JourneyProgress({ journey, variant = "full" }: { journey: JourneyData; variant?: "full" | "profile" | "home" }) {
  if (variant === "home") {
    if (!journey.currentStep) return null;
    return <Card className="p-4"><p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary">Continue Your Journey</p><div className="mt-2 flex items-center justify-between gap-4"><div className="min-w-0"><p className="truncate font-semibold">{journey.currentStep.title}</p><p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{journey.currentStep.description}</p></div><Link href={journey.currentStep.destination as Route} className="focus-ring grid h-10 w-10 shrink-0 place-items-center rounded-full border border-border/70 bg-secondary/30" aria-label={`Continue: ${journey.currentStep.title}`}><ArrowRight className="h-4 w-4" aria-hidden="true" /></Link></div></Card>;
  }

  if (variant === "profile") {
    return <Card className="p-5"><div className="flex items-start justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Journey</p><p className="mt-1 text-lg font-semibold">{journey.currentStep?.title ?? "Journey complete"}</p><p className="mt-1 text-sm text-muted-foreground">{journey.completedCount} of {journey.totalCount} steps complete</p></div><span className="rounded-full bg-secondary/50 px-3 py-1 text-sm font-semibold tabular-nums">{journey.completedCount}/{journey.totalCount}</span></div><Link href="/buddy-score" className="focus-ring mt-4 inline-flex items-center gap-1.5 rounded-lg text-sm font-semibold text-primary">View My Progress <ArrowRight className="h-4 w-4" aria-hidden="true" /></Link></Card>;
  }

  return <div className="overflow-hidden rounded-2xl border border-border/70 bg-card/45">{journey.steps.map((step, index) => <div key={step.id} className={cn("flex gap-3 px-4 py-4 sm:px-5", index > 0 && "border-t border-border/60", step.state === "locked" && "text-muted-foreground")}><span className={cn("mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full border", step.state === "completed" ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-500" : step.state === "current" ? "border-primary/50 bg-primary/10 text-primary" : "border-border bg-secondary/25")} aria-hidden="true">{step.state === "completed" ? <Check className="h-4 w-4" /> : step.state === "current" ? <Circle className="h-3.5 w-3.5 fill-current" /> : <LockKeyhole className="h-3.5 w-3.5" />}</span><div className="min-w-0 flex-1"><div className="flex items-start justify-between gap-3"><div><p className="text-sm font-semibold text-foreground">{step.title}</p><p className="mt-1 text-sm leading-6 text-muted-foreground">{step.state === "locked" ? "Complete the previous step to continue." : step.description}</p>{step.state !== "locked" ? <p className="mt-1 text-xs text-muted-foreground">{step.unlockCondition}</p> : null}</div>{step.state === "completed" && step.guide ? <JourneyGuideButton tourVersionId={step.guide.tourVersionId} destination={step.destination} label={step.title} /> : null}</div>{step.state === "current" ? <Link href={step.destination as Route} className="focus-ring mt-3 inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground">Continue <ArrowRight className="h-4 w-4" aria-hidden="true" /></Link> : null}</div></div>)}</div>;
}
