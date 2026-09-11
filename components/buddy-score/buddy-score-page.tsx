import type { Route } from "next";
import Link from "next/link";
import { Check, ChevronRight, ShieldCheck, Sparkles, Trophy, UserRound } from "lucide-react";
import { Card } from "@/components/ui/card";
import { JourneyProgress } from "@/components/journey/journey-progress";
import { AchievementRow, ActivityRow, formatDate } from "@/components/buddy-score/progress-rows";
import type { MyProgressData } from "@/lib/progress/my-progress";
import { TOUR_TARGET_IDS } from "@/lib/tours/registry";
import { PageHeader } from "@/components/app-shell/page-header";

/**
 * My Progress -- the information-architecture rebuild.
 *
 * The old page put nine sections of roughly equal visual weight on screen at
 * once, several of them different views of the exact same score/activity
 * events (a short recent-activity list inside the score card, then a second
 * Recent Activity section a few hundred pixels later covering the same
 * ledger). It answered no question first -- reputation, achievements, and
 * "what do I do next" all competed for the same amount of space.
 *
 * This version orders the page around three questions, in order: where am I
 * now (one merged summary card), what have I achieved (compact previews),
 * and what should I do next (the Journey's next step, given the richest
 * treatment because it's the one thing actionable today). Full history for
 * achievements and activity moves behind "View all" / "View activity
 * history" -- the detailed data is not deleted, just no longer the default
 * shape of the main page. Buddy Score math, reputation thresholds,
 * achievement/milestone truth and privacy semantics are untouched; this is
 * presentation only.
 */
export function BuddyScorePage({ progress }: { progress: MyProgressData }) {
  const { score, profileCompletion, achievements, milestones, timeline, journey } = progress;
  const recentActivity = timeline.slice(0, 5);
  // achievements.featured is capped to 3 by featuredAchievements() (the
  // helper other profile surfaces reuse for a strict "top 3" treatment), so
  // reading it here silently discarded the 4th preview row every rebuild
  // intended. achievements.all is already earned_at-desc, so slicing it
  // directly gives the real newest-3-4 preview the brief calls for.
  const recentAchievements = achievements.all.slice(0, 4);

  return (
    <div className="mx-auto w-full max-w-[1040px] space-y-7 pb-8 md:pt-6">
      <PageHeader title="My Progress" backHref="/profile" />

      <header className="pt-1 md:pt-0">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">Private to you</p>
        <h1 className="mt-1.5 hidden text-3xl font-semibold tracking-tight md:block">My Progress</h1>
        <p className="mt-1.5 max-w-2xl text-sm leading-6 text-muted-foreground">The trust and participation you have built over time. Only you can see this.</p>
      </header>

      {/* A. WHERE AM I NOW -- reputation, Buddy Score and privacy state merged
          into one card instead of two. Profile completion, which used to be
          a third card in an "Identity" row, folds in here as a light
          supporting stat rather than its own section -- it is the same kind
          of "where things stand" fact as the score itself. */}
      <section data-tour-id={TOUR_TARGET_IDS.BUDDY_SCORE_OVERVIEW} aria-labelledby="progress-summary-title">
        <h2 id="progress-summary-title" className="sr-only">Progress summary</h2>
        <Card className="p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-secondary/35 text-primary" aria-hidden="true">
                <ShieldCheck className="h-5 w-5" />
              </span>
              <div>
                <p className="text-lg font-semibold leading-tight text-foreground">{score.level.label}</p>
                <p className="text-xs text-muted-foreground">Reputation level</p>
              </div>
            </div>
            <div className="text-right">
              <p className="text-3xl font-semibold leading-none tabular-nums text-foreground">{score.total.toLocaleString()}</p>
              <p className="mt-1 text-xs text-muted-foreground">Buddy Score</p>
            </div>
          </div>

          {/* Progress toward the next real reputation threshold -- only
              rendered when one exists (BUDDY_SCORE_LEVELS has no level past
              Legend), so this never implies a made-up next tier. */}
          {score.nextLevel ? (
            <div className="mt-5">
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="font-medium text-foreground">Progress to {score.nextLevel.label}</span>
                <span className="font-semibold tabular-nums text-muted-foreground">{score.progressPercent}%</span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-secondary" role="progressbar" aria-label={`Progress to ${score.nextLevel.label}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={score.progressPercent}>
                <span className="block h-full rounded-full bg-primary transition-[width] duration-500 ease-in-out motion-reduce:transition-none" style={{ width: `${score.progressPercent}%` }} />
              </div>
              <p className="mt-1.5 text-xs text-muted-foreground">{score.pointsToNext} points to go</p>
            </div>
          ) : (
            <div className="mt-5 flex items-center gap-2 text-sm text-muted-foreground">
              <Trophy className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
              <span>A rare level reflecting long-term trusted participation.</span>
            </div>
          )}

          <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-border/60 pt-4">
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <ShieldCheck className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              Your exact score is visible only to you.
            </p>
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <UserRound className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              Profile {profileCompletion.percent}% complete
            </p>
          </div>
        </Card>
      </section>

      {/* B. WHAT SHOULD I DO NEXT -- the single incomplete Journey step gets
          the rich treatment; everything already completed collapses behind
          a disclosure so it cannot push the actionable step down the page. */}
      <section aria-labelledby="progress-journey-title">
        <SectionHeading id="progress-journey-title" title="Journey Progress" description="Your next meaningful step, plus what you have already completed." />
        <div className="mt-4"><JourneyProgress journey={journey} /></div>
      </section>

      {/* C. WHAT HAVE I ACHIEVED -- newest few, compact rows, full gallery
          one tap away. The old "Recently earned" chip rail duplicated these
          same names with no added function beyond deep-linking into the
          gallery -- that deep link now lives on each row instead, so the
          capability survives without a second, redundant list on the same
          page. */}
      <section aria-labelledby="progress-achievements-title">
        <SectionHeader id="progress-achievements-title" title="Achievements" description={`${achievements.unlockedCount} unlocked through real activity.`} href="/badges" actionLabel="View all" />
        {recentAchievements.length ? (
          <Card className="mt-4 divide-y divide-border/60 p-0">
            {recentAchievements.map((achievement) => <AchievementRow key={achievement.code} achievement={achievement} />)}
          </Card>
        ) : (
          <Card className="mt-4 p-5"><p className="font-semibold">No achievements yet</p><p className="mt-1 text-sm text-muted-foreground">Achievements appear after meaningful milestones. There is no rush.</p></Card>
        )}
      </section>

      {/* Milestones -- deliberately kept separate from Journey and Recent
          Activity. It answers a different question ("meaningful firsts
          I've reached", drawn from the activation-milestone ledger) than
          Journey ("what should I do in the product", a fixed onboarding
          sequence) or Recent Activity (every scored event). Light polish
          only, per the existing compact-row direction. */}
      <section aria-labelledby="progress-milestones-title">
        <SectionHeading id="progress-milestones-title" title="Milestones" description="Meaningful first steps you have completed." />
        {milestones.length ? (
          <Card className="mt-4 divide-y divide-border/60 p-0">
            {milestones.map((milestone) => (
              <div key={milestone.key} className="flex min-h-11 items-center gap-3 px-4 py-3">
                <Check className="h-4 w-4 shrink-0 text-emerald-500" aria-hidden="true" />
                <span className="min-w-0 flex-1 text-sm font-medium text-foreground">{milestone.label}</span>
                <time className="shrink-0 text-xs tabular-nums text-muted-foreground" dateTime={milestone.reachedAt}>{formatDate(milestone.reachedAt)}</time>
              </div>
            ))}
          </Card>
        ) : (
          <Card className="mt-4 flex items-center gap-3 p-5"><Sparkles className="h-5 w-5 text-muted-foreground" aria-hidden="true" /><p className="text-sm text-muted-foreground">Completed milestones will appear here.</p></Card>
        )}
      </section>

      {/* Recent Activity -- the single canonical place score events and
          achievement unlocks render together. The summary card above used to
          repeat the latest score events a second time in its own short list;
          that block is gone, this is now the only place those events appear
          on the main page. */}
      <section data-tour-id={TOUR_TARGET_IDS.BUDDY_SCORE_BREAKDOWN} aria-labelledby="progress-activity-title">
        <SectionHeader id="progress-activity-title" title="Recent Activity" description="A private timeline of score events and achievements." href="/buddy-score/activity" actionLabel="View activity history" />
        {recentActivity.length ? (
          <Card className="mt-4 divide-y divide-border/60 p-0">
            {recentActivity.map((item) => <ActivityRow key={item.id} item={item} />)}
          </Card>
        ) : (
          <Card className="mt-4 p-5"><p className="font-semibold">No recent activity</p><p className="mt-1 text-sm text-muted-foreground">Your verified progress will appear here as it happens.</p></Card>
        )}
      </section>
    </div>
  );
}

function SectionHeading({ id, title, description }: { id: string; title: string; description: string }) {
  return <div><h2 id={id} className="text-xl font-semibold tracking-tight text-foreground">{title}</h2><p className="mt-1 text-sm text-muted-foreground">{description}</p></div>;
}

/** Section heading with a trailing "View all" style action -- internal
 * navigation, so a chevron rather than an external-link arrow. */
function SectionHeader({ id, title, description, href, actionLabel }: { id: string; title: string; description: string; href: Route; actionLabel: string }) {
  return (
    <div className="flex items-end justify-between gap-4">
      <SectionHeading id={id} title={title} description={description} />
      <Link href={href} className="focus-ring inline-flex min-h-11 shrink-0 items-center gap-0.5 rounded text-sm font-semibold text-primary">
        {actionLabel} <ChevronRight className="h-4 w-4" aria-hidden="true" />
      </Link>
    </div>
  );
}

