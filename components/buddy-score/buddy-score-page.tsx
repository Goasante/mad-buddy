import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowUpRight, Award, BadgeCheck, CheckCircle2, CircleDashed, Clock3, ShieldCheck, Trophy, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PremiumPlanBadge } from "@/components/premium/premium-plan-badge";
import { JourneyProgress } from "@/components/journey/journey-progress";
import type { MyProgressData } from "@/lib/progress/my-progress";
import { TOUR_TARGET_IDS } from "@/lib/tours/registry";
import { PageHeader } from "@/components/app-shell/page-header";

export function BuddyScorePage({ progress }: { progress: MyProgressData }) {
  const { score, membership, profileCompletion, achievements, milestones, timeline, journey } = progress;
  return (
    <div className="mx-auto w-full max-w-[1040px] space-y-8 pb-8 md:pt-6">
      {/* Reached from Me rather than a bottom-nav tab, so it uses the nested
          Back variant. */}
      <PageHeader title="My Progress" backHref="/profile" />

      <header className="pt-1 md:pt-0">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">Private to you</p>
        {/* Hidden on mobile: the shared header carries the title there. */}
        <h1 className="mt-2 hidden text-3xl font-semibold tracking-tight md:block">My Progress</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">A calm view of the trust, connections, and meaningful participation you are building over time.</p>
      </header>

      <section aria-labelledby="progress-identity-title">
        <SectionHeading id="progress-identity-title" title="Identity" description="The essentials that shape your Mad Buddy identity." />
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <IdentityCard label="Membership" value={membership.planLabel} icon={BadgeCheck} accessory={<PremiumPlanBadge plan={membership.plan} compact />} />
          <IdentityCard label="Reputation" value={score.level.label} icon={ShieldCheck} />
          <IdentityCard label="Buddy Score" value={String(score.total)} icon={Award} hint="Visible only to you" />
          <IdentityCard label="Profile completion" value={`${profileCompletion.percent}%`} icon={UserRound} hint={`${profileCompletion.completed} of ${profileCompletion.total} essentials`} />
        </div>
      </section>

      <section data-tour-id={TOUR_TARGET_IDS.BUDDY_SCORE_OVERVIEW} aria-labelledby="progress-score-title">
        <SectionHeading id="progress-score-title" title="Buddy Score" description="Built from verified milestones and genuine participation, never screen time or purchases." />
        <Card className="mt-4 grid gap-6 p-5 sm:p-6 lg:grid-cols-[220px_minmax(0,1fr)]">
          <div className="rounded-2xl bg-secondary/25 p-5">
            <ShieldCheck className="h-6 w-6 text-primary" aria-hidden="true" />
            <p className="mt-5 text-5xl font-semibold tabular-nums">{score.total}</p>
            <p className="mt-1 font-semibold text-primary">{score.level.label}</p>
            <p className="mt-2 text-xs text-muted-foreground">Your exact score is private.</p>
          </div>
          <div className="flex min-w-0 flex-col justify-center">
            {score.nextLevel ? (
              <>
                <div className="flex items-end justify-between gap-4"><div><p className="font-semibold">Progress to {score.nextLevel.label}</p><p className="mt-1 text-sm text-muted-foreground">{score.pointsToNext} points to go</p></div><span className="text-sm font-semibold tabular-nums">{score.progressPercent}%</span></div>
                <div className="mt-4 h-2 overflow-hidden rounded-full bg-secondary" role="progressbar" aria-label={`Progress to ${score.nextLevel.label}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={score.progressPercent}><span className="block h-full rounded-full bg-primary transition-[width] duration-500 ease-in-out motion-reduce:transition-none" style={{ width: `${score.progressPercent}%` }} /></div>
              </>
            ) : <div><Trophy className="h-6 w-6 text-primary" aria-hidden="true" /><p className="mt-3 font-semibold">Legend status earned</p><p className="mt-1 text-sm text-muted-foreground">A rare level reflecting long-term trusted participation.</p></div>}
            <div className="mt-6 border-t border-border/60 pt-4">
              <p className="text-sm font-semibold">Recent score activity</p>
              {score.recentActivity.length ? <div className="mt-2 divide-y divide-border/50">{score.recentActivity.slice(0, 3).map((item) => <div key={item.id} className="flex items-center justify-between gap-4 py-2.5"><div className="min-w-0"><p className="truncate text-sm font-medium">{item.label}</p><p className="text-xs text-muted-foreground">{formatDate(item.createdAt)}</p></div><PointDelta points={item.points} /></div>)}</div> : <p className="mt-2 text-sm text-muted-foreground">Your first trusted activity will appear here.</p>}
            </div>
          </div>
        </Card>
      </section>

      <section aria-labelledby="progress-achievements-title">
        <div className="flex items-end justify-between gap-4"><SectionHeading id="progress-achievements-title" title="Achievements" description={`${achievements.unlockedCount} unlocked through real activity.`} /><Link href="/badges" className="focus-ring inline-flex min-h-11 items-center gap-1 rounded text-sm font-semibold text-primary">View all <ArrowUpRight className="h-4 w-4" aria-hidden="true" /></Link></div>
        {achievements.featured.length ? <><div className="mt-4 grid gap-3 sm:grid-cols-3">{achievements.featured.map((achievement) => <Card key={achievement.code} className="p-4"><div className="flex items-center gap-3">{achievement.iconPath ? <Image src={achievement.iconPath} alt="" width={48} height={48} className="h-12 w-12 object-contain" /> : <Award className="h-8 w-8 text-primary" aria-hidden="true" />}<div className="min-w-0"><p className="truncate font-semibold">{achievement.name}</p><p className="mt-1 text-xs text-muted-foreground">Earned {formatDate(achievement.earnedAt)}</p></div></div><p className="mt-3 text-sm leading-6 text-muted-foreground">{achievement.description}</p></Card>)}</div><div className="mt-4 flex flex-wrap items-center gap-2"><span className="mr-1 text-xs font-semibold text-muted-foreground">Recently earned</span>{achievements.recent.map((achievement) => <Link key={achievement.code} href={`/badges?achievement=${achievement.code}`} className="focus-ring rounded-full border border-border/70 px-3 py-1.5 text-xs font-medium">{achievement.name}</Link>)}</div></> : <Card className="mt-4 p-5"><p className="font-semibold">No achievements yet</p><p className="mt-1 text-sm text-muted-foreground">Achievements appear after meaningful milestones. There is no rush.</p></Card>}
      </section>

      <section aria-labelledby="progress-journey-title"><SectionHeading id="progress-journey-title" title="Journey Progress" description="Your completed steps and the next meaningful action." /><div className="mt-4"><JourneyProgress journey={journey} /></div></section>

      <section aria-labelledby="progress-membership-title"><SectionHeading id="progress-membership-title" title="Membership Progress" description="Your current access and progress-earned rewards." /><Card className="mt-4 p-5"><div className="flex items-center justify-between gap-3"><div><p className="text-sm text-muted-foreground">Current membership</p><p className="mt-1 text-lg font-semibold">{membership.planLabel}</p></div><PremiumPlanBadge plan={membership.plan} /></div>{score.earnedReward ? <div className="mt-4 border-t border-border/60 pt-4"><p className="text-sm font-semibold">Earned {score.earnedReward.plan === "buddy_pro" ? "Buddy Pro" : "Buddy Plus"} access</p><p className="mt-1 text-xs text-muted-foreground">{score.earnedReward.status === "grace" ? "Grace period active" : `Active until ${formatDate(score.earnedReward.expiresAt)}`}</p></div> : <p className="mt-4 border-t border-border/60 pt-4 text-sm leading-6 text-muted-foreground">Trusted participation is reviewed automatically for earned rewards. Internal eligibility calculations stay private.</p>}</Card></section>

      <section aria-labelledby="progress-milestones-title">
        <SectionHeading id="progress-milestones-title" title="Milestones" description="Meaningful first steps you have completed." />
        {milestones.length ? <Card className="mt-4 divide-y divide-border/60 p-0">{milestones.map((milestone) => <div key={milestone.key} className="flex items-center gap-3 px-4 py-3.5"><CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" aria-hidden="true" /><span className="min-w-0 flex-1 text-sm font-medium">{milestone.label}</span><time className="text-xs text-muted-foreground" dateTime={milestone.reachedAt}>{formatDate(milestone.reachedAt)}</time></div>)}</Card> : <Card className="mt-4 flex items-center gap-3 p-5"><CircleDashed className="h-5 w-5 text-muted-foreground" aria-hidden="true" /><p className="text-sm text-muted-foreground">Completed milestones will appear here.</p></Card>}
      </section>

      <section data-tour-id={TOUR_TARGET_IDS.BUDDY_SCORE_BREAKDOWN} aria-labelledby="progress-activity-title">
        <SectionHeading id="progress-activity-title" title="Recent Activity" description="A private timeline of score events and achievements." />
        {timeline.length ? <Card className="mt-4 divide-y divide-border/60 p-0">{timeline.map((item) => <div key={item.id} className="flex items-center gap-3 px-4 py-3.5"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-secondary/35">{item.kind === "achievement" ? <Award className="h-4 w-4 text-primary" aria-hidden="true" /> : <Clock3 className="h-4 w-4 text-muted-foreground" aria-hidden="true" />}</span><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{item.label}</p><p className="text-xs text-muted-foreground">{item.detail} · {formatDate(item.occurredAt)}</p></div>{item.points !== null ? <PointDelta points={item.points} /> : null}</div>)}</Card> : <Card className="mt-4 p-5"><p className="font-semibold">No recent activity</p><p className="mt-1 text-sm text-muted-foreground">Your verified progress will appear here as it happens.</p></Card>}
      </section>

      <div className="flex justify-end"><Button asChild variant="outline"><Link href="/profile">View profile <ArrowUpRight className="h-4 w-4" aria-hidden="true" /></Link></Button></div>
    </div>
  );
}

function SectionHeading({ id, title, description }: { id: string; title: string; description: string }) { return <div><h2 id={id} className="text-xl font-semibold tracking-tight">{title}</h2><p className="mt-1 text-sm text-muted-foreground">{description}</p></div>; }

function IdentityCard({ label, value, icon: Icon, hint, accessory }: { label: string; value: string; icon: typeof Award; hint?: string; accessory?: ReactNode }) { return <Card className="min-h-32 p-4"><div className="flex items-start justify-between gap-2"><Icon className="h-5 w-5 text-primary" aria-hidden="true" />{accessory}</div><p className="mt-5 text-xs text-muted-foreground">{label}</p><p className="mt-1 font-semibold">{value}</p>{hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}</Card>; }

function PointDelta({ points }: { points: number }) { return <span className={points >= 0 ? "text-sm font-semibold text-emerald-500" : "text-sm font-semibold text-red-500"}>{points > 0 ? "+" : ""}{points}</span>; }

function formatDate(value: string) { return new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(new Date(value)); }
