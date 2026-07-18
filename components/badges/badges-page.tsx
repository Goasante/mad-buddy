"use client";

import { Award, Flame, HandHeart, PauseCircle, ShieldCheck, Sparkles, Users } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useState, useTransition } from "react";
import { pauseStreakAction, type EngagementOverview } from "@/app/(app)/engagement-actions";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type BadgesTab = "achievements" | "streaks" | "recap";

const tabs: Array<{ id: BadgesTab; label: string }> = [
  { id: "achievements", label: "Achievements" },
  { id: "streaks", label: "Streaks" },
  { id: "recap", label: "Monthly recap" }
];

const categoryIcons: Record<string, LucideIcon> = {
  connection: HandHeart,
  community: Users,
  privacy: ShieldCheck,
  balance: Sparkles,
  safety: Award
};

const recapRows: Array<{ key: string; label: string }> = [
  { key: "plansCompleted", label: "Plans completed" },
  { key: "plansCreated", label: "Plans created" },
  { key: "muddiesInteractedWith", label: "Muddies you made time for" },
  { key: "newMuddies", label: "New Muddies" },
  { key: "wavesSent", label: "Waves sent" },
  { key: "hangoutSessions", label: "Hangouts hosted" },
  { key: "daysVisible", label: "Days with your glow on" }
];

/**
 * Private by design (batch 11): everything on this page is the viewer's own
 * data. No comparisons, no rankings, no "days active" pressure, the copy
 * states what happened and stops (spec §6, §26, §44).
 */
export function BadgesPageContent({ overview }: { overview: EngagementOverview }) {
  const [tab, setTab] = useState<BadgesTab>("achievements");
  const [streaks, setStreaks] = useState(overview.streaks);
  const [feedback, setFeedback] = useState("");
  const [isPending, startTransition] = useTransition();

  const earnedCount = overview.achievements.filter((achievement) => achievement.earned).length;

  function pause(streakId: string) {
    startTransition(async () => {
      const result = await pauseStreakAction(streakId, 2);
      setFeedback(result.message);
      if (result.ok) {
        setStreaks((current) =>
          current.map((streak) => (streak.streakId === streakId ? { ...streak, status: "paused" } : streak))
        );
      }
    });
  }

  return (
    <div className="mx-auto max-w-[1000px] space-y-6 pt-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Achievements & Recaps</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Private to you. Nothing here is ranked, compared, or shown to anyone else.
        </p>
      </div>

      {feedback ? (
        <p className="text-sm text-muted-foreground" role="status">
          {feedback}
        </p>
      ) : null}

      <div className="flex gap-1 border-b border-border/70">
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setTab(item.id)}
            className={cn(
              "focus-ring safe-motion border-b-2 px-4 py-3 text-sm font-medium",
              tab === item.id ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab === "achievements" ? (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {earnedCount} of {overview.achievements.length} earned. Criteria are always visible, nothing is random.
          </p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {overview.achievements.map((achievement) => {
              const Icon = categoryIcons[achievement.category] ?? Award;
              return (
                <div
                  key={achievement.code}
                  className={cn(
                    "rounded-xl border p-4",
                    achievement.earned ? "border-primary/40 bg-primary/5" : "border-border/70 bg-card/50 opacity-70"
                  )}
                >
                  <Icon
                    className={cn("h-5 w-5", achievement.earned ? "text-primary" : "text-muted-foreground")}
                    aria-hidden="true"
                  />
                  <p className="mt-2 text-sm font-semibold">{achievement.name}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{achievement.description}</p>
                  {achievement.earned && achievement.earnedAt ? (
                    <p className="mt-2 text-[11px] text-muted-foreground">
                      Earned {new Date(achievement.earnedAt).toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" })}
                    </p>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {tab === "streaks" ? (
        <div className="space-y-3">
          {streaks.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No active streaks yet. A streak starts when you and a Muddy both connect in the same week, and it&apos;s
              always fine to let one end.
            </p>
          ) : (
            streaks.map((streak) => (
              <div
                key={streak.streakId}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/70 bg-card/50 p-4"
              >
                <div className="flex items-center gap-3">
                  <Flame className="h-5 w-5 text-primary" aria-hidden="true" />
                  <div>
                    <p className="text-sm font-medium">{streak.label}</p>
                    <p className="text-xs text-muted-foreground">
                      Longest: {streak.longestWeeks} {streak.longestWeeks === 1 ? "week" : "weeks"}
                      {streak.status === "paused" ? " · Paused" : ""}
                    </p>
                  </div>
                </div>
                {streak.status === "active" ? (
                  <Button type="button" variant="outline" size="sm" disabled={isPending} onClick={() => pause(streak.streakId)}>
                    <PauseCircle className="h-4 w-4" aria-hidden="true" />
                    Pause 2 weeks
                  </Button>
                ) : null}
              </div>
            ))
          )}
          <p className="text-xs text-muted-foreground">
            Pausing is free, always. Streaks never cost anything to keep or recover.
          </p>
        </div>
      ) : null}

      {tab === "recap" ? (
        overview.recap ? (
          <div className="space-y-4 rounded-2xl border border-border/70 bg-card/50 p-5">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {overview.recap.periodLabel}
            </p>
            <h2 className="text-xl font-semibold">{overview.recap.headline}</h2>
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {recapRows.map((row) => (
                <div key={row.key} className="rounded-xl border border-border/70 bg-background/60 p-3 text-center">
                  <dd className="text-lg font-semibold tabular-nums">
                    {overview.recap?.summary[row.key as keyof typeof overview.recap.summary] ?? 0}
                  </dd>
                  <dt className="mt-1 text-[11px] text-muted-foreground">{row.label}</dt>
                </div>
              ))}
            </dl>
            <p className="text-sm text-muted-foreground">{overview.recap.reflectionPrompt}</p>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Your first monthly recap arrives after a full month of activity. A quiet month is fine too.
          </p>
        )
      ) : null}
    </div>
  );
}
