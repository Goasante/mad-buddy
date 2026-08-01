import Link from "next/link";
import { ArrowUpRight, Award, Clock3, ShieldCheck, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PremiumPlanBadge } from "@/components/premium/premium-plan-badge";
import type { BuddyScoreData } from "@/lib/engagement/buddy-score-service";
import { TOUR_TARGET_IDS } from "@/lib/tours/registry";

export function BuddyScorePage({ score }: { score: BuddyScoreData }) {
  return (
    <div className="mx-auto max-w-[960px] space-y-7 pt-6">
      <header data-tour-id={TOUR_TARGET_IDS.BUDDY_SCORE_OVERVIEW}>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-orange-400">Private trust summary</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">Buddy Score</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">Built from genuine, sustained participation. Your score is private and cannot be purchased.</p>
      </header>

      <section className="grid gap-5 rounded-3xl border border-border/70 bg-card/55 p-5 sm:grid-cols-[220px_minmax(0,1fr)] sm:p-7" aria-label={`Buddy Score ${score.total}, ${score.level.label}`}>
        <div className="flex min-h-44 flex-col justify-center rounded-2xl bg-background/55 p-5">
          <ShieldCheck className="h-6 w-6 text-orange-400" aria-hidden="true" />
          <p className="mt-5 text-5xl font-semibold tabular-nums">{score.total}</p>
          <p className="mt-1 text-sm font-semibold text-orange-300">{score.level.label}</p>
          <p className="mt-2 text-xs text-muted-foreground">Visible only to you</p>
        </div>
        <div className="flex flex-col justify-center">
          {score.nextLevel ? (
            <>
              <div className="flex items-end justify-between gap-3"><div><p className="text-sm font-semibold">Progress to {score.nextLevel.label}</p><p className="mt-1 text-xs text-muted-foreground">{score.pointsToNext} points to go</p></div><span className="text-sm font-semibold tabular-nums">{score.progressPercent}%</span></div>
              <div className="mt-4 h-2 overflow-hidden rounded-full bg-secondary" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={score.progressPercent}><div className="h-full rounded-full bg-orange-500 transition-[width] duration-500 ease-in-out" style={{ width: `${score.progressPercent}%` }} /></div>
            </>
          ) : <div><Sparkles className="h-7 w-7 text-orange-400" aria-hidden="true" /><p className="mt-3 text-lg font-semibold">Legend status earned</p><p className="mt-1 text-sm text-muted-foreground">This level reflects rare, long-term trusted participation.</p></div>}
          <p className="mt-6 text-sm leading-6 text-muted-foreground">Points come from verified account milestones, approved connections, completed plans, Safe Arrival completions, and earned achievements. Reports alone never reduce your score.</p>
        </div>
      </section>

      {score.earnedReward ? <section className="rounded-2xl border border-orange-500/30 bg-orange-500/[0.06] p-5"><p className="text-xs font-semibold uppercase tracking-[0.16em] text-orange-400">Earned premium</p><div className="mt-2 flex flex-wrap items-end justify-between gap-3"><div><div className="flex flex-wrap items-center gap-2"><h2 className="text-lg font-semibold">{score.earnedReward.plan === "buddy_pro" ? "Buddy Pro" : "Buddy Plus"} access</h2><PremiumPlanBadge plan={score.earnedReward.plan} compact /></div><p className="mt-1 text-sm text-muted-foreground">{score.earnedReward.status === "grace" ? "Grace period active" : "Unlocked through trusted participation"}</p></div><p className="text-xs text-muted-foreground">Ends {new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(new Date(score.earnedReward.graceEndsAt ?? score.earnedReward.expiresAt))}</p></div></section> : null}

      <div className="grid items-start gap-5 md:grid-cols-2">
        <section data-tour-id={TOUR_TARGET_IDS.BUDDY_SCORE_BREAKDOWN} className="rounded-2xl border border-border/70 bg-card/45 p-5" aria-labelledby="score-categories-title">
          <h2 id="score-categories-title" className="flex items-center gap-2 text-base font-semibold"><Award className="h-5 w-5 text-orange-400" aria-hidden="true" />Earning categories</h2>
          {score.categories.length ? <div className="mt-4 divide-y divide-border/60">{score.categories.map((item) => <div key={item.label} className="flex items-center justify-between gap-4 py-3 text-sm"><span className="text-muted-foreground">{item.label}</span><span className="font-semibold tabular-nums">{item.points > 0 ? "+" : ""}{item.points}</span></div>)}</div> : <EmptyCopy title="Your score starts here" description="Complete your profile and build genuine connections to begin earning points." />}
        </section>
        <section className="rounded-2xl border border-border/70 bg-card/45 p-5" aria-labelledby="score-history-title">
          <h2 id="score-history-title" className="flex items-center gap-2 text-base font-semibold"><Clock3 className="h-5 w-5 text-orange-400" aria-hidden="true" />Recent score activity</h2>
          {score.recentActivity.length ? <div className="mt-4 divide-y divide-border/60">{score.recentActivity.slice(0, 6).map((item) => <div key={item.id} className="flex items-center justify-between gap-4 py-3"><div><p className="text-sm font-medium">{item.label}</p><p className="mt-0.5 text-xs text-muted-foreground">{new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(new Date(item.createdAt))}</p></div><span className={item.points >= 0 ? "text-sm font-semibold text-emerald-400" : "text-sm font-semibold text-red-400"}>{item.points > 0 ? "+" : ""}{item.points}</span></div>)}</div> : <EmptyCopy title="No score activity yet" description="Legitimate score events will appear here." />}
        </section>
      </div>

      <div className="flex flex-col gap-3 rounded-2xl border border-border/70 bg-card/40 p-5 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-sm font-semibold">Designed to reward trust, not popularity</p><p className="mt-1 text-sm text-muted-foreground">Private messages, exact location, contacts, and raw screen time are never scored.</p></div><Button asChild variant="outline" size="sm"><Link href="/badges">Achievements <ArrowUpRight className="h-4 w-4" aria-hidden="true" /></Link></Button></div>
    </div>
  );
}

function EmptyCopy({ title, description }: { title: string; description: string }) {
  return <div className="mt-4 rounded-xl bg-background/45 p-4"><p className="text-sm font-semibold">{title}</p><p className="mt-1 text-sm leading-6 text-muted-foreground">{description}</p></div>;
}
