import { Card } from "@/components/ui/card";
import { ActivityRow } from "@/components/buddy-score/progress-rows";
import { progressTimeline, type MyProgressData } from "@/lib/progress/my-progress";
import { PageHeader } from "@/components/app-shell/page-header";

/**
 * Full activity history -- everything Recent Activity on My Progress
 * previews (latest 3-5), in full: every score ledger event and achievement
 * unlock, chronologically. Same row presentation as the preview so this
 * reads as "the rest of the same list," not a different surface.
 */
export function ActivityHistoryPage({ progress }: { progress: MyProgressData }) {
  const { score, achievements } = progress;
  // Recompute at full depth rather than reuse progress.timeline (which the
  // main page's server action already caps for its own preview needs) --
  // both draw from the same score + achievements, so nothing here can drift
  // from what My Progress showed a summary of.
  const fullTimeline = progressTimeline(score, achievements.all, 500);

  return (
    <div className="mx-auto w-full max-w-[720px] space-y-6 pb-8 md:pt-6">
      <PageHeader title="Activity history" backHref="/buddy-score" />
      <header className="pt-1 md:pt-0">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">Private to you</p>
        <h1 className="mt-1.5 hidden text-3xl font-semibold tracking-tight md:block">Activity history</h1>
        <p className="mt-1.5 max-w-2xl text-sm leading-6 text-muted-foreground">Every score event and achievement unlock, in order.</p>
      </header>

      {fullTimeline.length ? (
        <Card className="divide-y divide-border/60 p-0">
          {fullTimeline.map((item) => <ActivityRow key={item.id} item={item} />)}
        </Card>
      ) : (
        <Card className="p-5"><p className="font-semibold">No activity yet</p><p className="mt-1 text-sm text-muted-foreground">Your verified progress will appear here as it happens.</p></Card>
      )}
    </div>
  );
}
