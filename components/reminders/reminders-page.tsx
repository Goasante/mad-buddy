import Link from "next/link";
import { Bell, CalendarClock, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import type { HomeUpcomingPlan } from "@/lib/social/upcoming-plans";

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

export function RemindersPage({ plans, hasMore }: { plans: HomeUpcomingPlan[]; hasMore: boolean }) {
  return (
    <div className="mx-auto max-w-[900px] space-y-6 pt-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Reminders</h1>
          <p className="mt-2 text-sm text-muted-foreground">Upcoming plans that need your attention.</p>
        </div>
        <Button asChild type="button" variant="outline" size="icon" aria-label="Notification settings" title="Notification settings">
          <Link href="/settings/notifications"><Settings className="h-4 w-4" aria-hidden="true" /></Link>
        </Button>
      </header>
      {plans.length > 0 ? (
        <section className="space-y-2" aria-label="Upcoming plan reminders">
          {plans.map((plan) => (
            <article key={plan.id} className="flex flex-col gap-3 rounded-xl border border-border/70 bg-card/50 p-4 sm:flex-row sm:items-center">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
                <CalendarClock className="h-5 w-5" aria-hidden="true" />
              </span>
              <div className="min-w-0 flex-1">
                <h2 className="truncate text-sm font-semibold">{plan.title}</h2>
                <p className="text-xs text-muted-foreground">{formatDate(plan.startAt)}{plan.placeText ? ` · ${plan.placeText}` : ""}</p>
              </div>
              <Button asChild type="button" variant="outline" size="sm"><Link href="/plans">View plan</Link></Button>
            </article>
          ))}
          {hasMore ? <Button asChild type="button" variant="ghost"><Link href="/plans">View all plans</Link></Button> : null}
        </section>
      ) : (
        <EmptyState icon={Bell} className="!min-h-0 !shadow-none p-6" title="No upcoming reminders" description="Confirmed and invited plans with a future date will appear here." action={<Button asChild type="button" size="sm"><Link href="/plans">Create a plan</Link></Button>} />
      )}
    </div>
  );
}
