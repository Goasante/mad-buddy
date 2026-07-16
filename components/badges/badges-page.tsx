"use client";

import { Award, Calendar, HandHeart, Medal, Sparkles, Target, Trophy } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

type BadgesTab = "overview" | "badges" | "milestones";

type Badge = { title: string; description: string; icon: LucideIcon; earned: boolean };
type Milestone = { title: string; description: string; progress: number; total: number; completed: boolean };

const overviewStats = [
  { label: "Badges earned", value: 23 },
  { label: "Milestones achieved", value: 7 },
  { label: "Days active", value: 84 },
  { label: "People you've helped", value: 31 }
];

const badgesList: Badge[] = [
  { title: "First Wave", description: "Wave to 5 people", icon: Sparkles, earned: true },
  { title: "Plan Maker", description: "Create 3 plans", icon: Target, earned: true },
  { title: "On Time", description: "Never late to plans", icon: Medal, earned: true },
  { title: "Good Vibes", description: "Positive interactions", icon: HandHeart, earned: true },
  { title: "Helper", description: "Help 10 Muddies", icon: Award, earned: true },
  { title: "Streak Master", description: "30-day active streak", icon: Trophy, earned: false }
];

const milestones: Milestone[] = [
  { title: "7 Day Streak", description: "Keep the vibe going", progress: 7, total: 7, completed: true },
  { title: "30 Plans Created", description: "Create and host plans", progress: 24, total: 30, completed: false },
  { title: "50 Waves Sent", description: "Connect with more people", progress: 37, total: 50, completed: false },
  { title: "100 Days Active", description: "Stay consistent", progress: 84, total: 100, completed: false }
];

const tabs: Array<{ id: BadgesTab; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "badges", label: "Badges" },
  { id: "milestones", label: "Milestones" }
];

export function BadgesPageContent() {
  const [tab, setTab] = useState<BadgesTab>("overview");
  const nextMilestone = milestones.find((milestone) => !milestone.completed);

  return (
    <div className="mx-auto max-w-[1000px] space-y-6 pt-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Badges & Achievements</h1>
        <p className="mt-2 text-sm text-muted-foreground">Celebrate your vibe, consistency, and positive impact.</p>
      </div>

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

      {tab === "overview" ? (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {overviewStats.map((stat) => (
              <div key={stat.label} className="rounded-xl border border-border/70 bg-card/50 p-4 text-center">
                <p className="text-xl font-semibold tabular-nums">{stat.value}</p>
                <p className="mt-1 text-xs text-muted-foreground">{stat.label}</p>
              </div>
            ))}
            {nextMilestone ? (
              <div className="col-span-2 rounded-xl border border-primary/30 bg-primary/10 p-4 text-center sm:col-span-1">
                <p className="text-xs font-semibold text-primary">Next milestone</p>
                <p className="mt-1 text-sm font-medium">{nextMilestone.title}</p>
                <p className="text-xs text-muted-foreground">{nextMilestone.progress}/{nextMilestone.total}</p>
              </div>
            ) : null}
          </div>

          <section>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-muted-foreground">Recent badges</h2>
              <button type="button" onClick={() => setTab("badges")} className="text-xs font-medium text-primary hover:underline">
                See all
              </button>
            </div>
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-5">
              {badgesList.slice(0, 5).map((badge) => (
                <BadgeTile key={badge.title} badge={badge} />
              ))}
            </div>
          </section>

          <section>
            <h2 className="mb-3 text-sm font-semibold text-muted-foreground">Milestones</h2>
            <div className="space-y-3">
              {milestones.map((milestone) => (
                <MilestoneRow key={milestone.title} milestone={milestone} />
              ))}
            </div>
          </section>
        </div>
      ) : null}

      {tab === "badges" ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {badgesList.map((badge) => (
            <BadgeTile key={badge.title} badge={badge} />
          ))}
        </div>
      ) : null}

      {tab === "milestones" ? (
        <div className="space-y-3">
          {milestones.map((milestone) => (
            <MilestoneRow key={milestone.title} milestone={milestone} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function BadgeTile({ badge }: { badge: Badge }) {
  return (
    <div className={cn("rounded-xl border p-4 text-center", badge.earned ? "border-primary/30 bg-primary/10" : "border-border bg-card/30 opacity-60")}>
      <span className={cn("mx-auto grid h-10 w-10 place-items-center rounded-full", badge.earned ? "bg-primary/15 text-primary" : "bg-secondary text-muted-foreground")}>
        <badge.icon className="h-5 w-5" aria-hidden="true" />
      </span>
      <p className="mt-2 text-xs font-semibold">{badge.title}</p>
      <p className="mt-1 text-[10px] text-muted-foreground">{badge.earned ? "Earned" : badge.description}</p>
    </div>
  );
}

function MilestoneRow({ milestone }: { milestone: Milestone }) {
  const percent = Math.min(100, Math.round((milestone.progress / milestone.total) * 100));
  return (
    <div className="rounded-xl border border-border/70 bg-card/50 p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Calendar className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
          <div>
            <p className="text-sm font-semibold">{milestone.title}</p>
            <p className="text-xs text-muted-foreground">{milestone.description}</p>
          </div>
        </div>
        <span className="shrink-0 text-xs font-medium text-muted-foreground">
          {milestone.completed ? "Completed" : `${milestone.progress}/${milestone.total}`}
        </span>
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-secondary">
        <div className="h-full rounded-full bg-primary" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}
