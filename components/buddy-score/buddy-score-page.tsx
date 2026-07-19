import Link from "next/link";
import { Activity, Award, CalendarCheck2, MessageSquare, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { BuddyScoreData } from "@/app/(app)/buddy-score-actions";

const icons = [Users, CalendarCheck2, MessageSquare, Award, Activity];

export function BuddyScorePage({ score }: { score: BuddyScoreData }) {
  const percent = Math.round((score.total / score.maximum) * 100);
  const circumference = 2 * Math.PI * 54;
  return (
    <div className="mx-auto max-w-[900px] space-y-6 pt-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Buddy Score</h1>
        <p className="mt-2 text-sm text-muted-foreground">A private summary of your real Mad Buddy activity.</p>
      </header>
      <div className="grid gap-6 sm:grid-cols-[auto_1fr]">
        <section className="flex flex-col items-center justify-center rounded-2xl border border-border/70 bg-card/50 p-6" aria-label={`Buddy Score ${score.total} out of ${score.maximum}`}>
          <div className="relative grid h-[140px] w-[140px] place-items-center">
            <svg width="140" height="140" viewBox="0 0 120 120" className="-rotate-90" aria-hidden="true">
              <circle cx="60" cy="60" r="54" fill="none" stroke="hsl(var(--secondary))" strokeWidth="10" />
              <circle cx="60" cy="60" r="54" fill="none" stroke="hsl(var(--primary))" strokeWidth="10" strokeLinecap="round" strokeDasharray={circumference} strokeDashoffset={circumference * (1 - percent / 100)} />
            </svg>
            <div className="absolute inset-0 grid place-items-center text-center"><div><p className="text-3xl font-bold tabular-nums">{score.total}</p><p className="text-xs text-muted-foreground">/{score.maximum}</p></div></div>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">Visible only to you</p>
        </section>
        <section className="rounded-2xl border border-border/70 bg-card/50 p-4" aria-labelledby="score-breakdown-title">
          <h2 id="score-breakdown-title" className="mb-3 text-sm font-semibold">Score breakdown</h2>
          <div className="space-y-3">
            {score.breakdown.map((item, index) => {
              const Icon = icons[index];
              return <div key={item.label} className="flex items-center justify-between gap-3 text-sm"><span className="flex items-center gap-2 text-muted-foreground"><Icon className="h-4 w-4" aria-hidden="true" />{item.label}<span className="text-xs">({item.detail})</span></span><span className="font-medium tabular-nums">{item.points}/{item.maximum}</span></div>;
            })}
          </div>
        </section>
      </div>
      <div className="rounded-xl border border-border/70 bg-card/50 p-4">
        <p className="text-sm font-semibold">How it works</p>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">The score uses your approved connections, completed plans, sent messages, earned achievements, and account age. It does not affect access, ranking, or who can find you.</p>
        <Button asChild type="button" variant="outline" size="sm" className="mt-3"><Link href="/badges">View achievements</Link></Button>
      </div>
    </div>
  );
}
