"use client";

import { CalendarCheck2, Clock, HandHeart, ThumbsUp, Users } from "lucide-react";
import type { LucideIcon } from "lucide-react";

const totalScore = 782;
const maxScore = 1000;

const scoreBreakdown: Array<{ label: string; value: number; icon: LucideIcon }> = [
  { label: "Positive interactions", value: 260, icon: ThumbsUp },
  { label: "On-time reliability", value: 180, icon: Clock },
  { label: "Plans & participation", value: 180, icon: CalendarCheck2 },
  { label: "Helpfulness", value: 110, icon: HandHeart },
  { label: "Account age", value: 52, icon: Users }
];

const improveTips = [
  { title: "Be on time", description: "Show up when it matters.", points: "+30 pts" },
  { title: "Create more plans", description: "Host plans people love.", points: "+20 pts" },
  { title: "Help your Muddies", description: "Be there when it counts.", points: "+20 pts" },
  { title: "Stay consistent", description: "Keep your streak going.", points: "+10 pts" }
];

export function BuddyScorePage() {
  const percent = Math.round((totalScore / maxScore) * 100);
  const circumference = 2 * Math.PI * 54;
  const dashOffset = circumference * (1 - percent / 100);

  return (
    <div className="mx-auto max-w-[900px] space-y-6 pt-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Buddy Score</h1>
        <p className="mt-2 text-sm text-muted-foreground">Your trust score that grows with good vibes.</p>
      </div>

      <div className="grid gap-6 sm:grid-cols-[auto_1fr]">
        <div className="flex flex-col items-center justify-center rounded-2xl border border-border/70 bg-card/50 p-6">
          <div className="relative grid h-[140px] w-[140px] place-items-center">
            <svg width="140" height="140" viewBox="0 0 120 120" className="-rotate-90">
              <circle cx="60" cy="60" r="54" fill="none" stroke="hsl(var(--secondary))" strokeWidth="10" />
              <circle
                cx="60"
                cy="60"
                r="54"
                fill="none"
                stroke="hsl(var(--primary))"
                strokeWidth="10"
                strokeLinecap="round"
                strokeDasharray={circumference}
                strokeDashoffset={dashOffset}
              />
            </svg>
            <div className="absolute inset-0 grid place-items-center text-center">
              <div>
                <p className="text-3xl font-bold tabular-nums">{totalScore}</p>
                <p className="text-xs text-muted-foreground">/{maxScore}</p>
              </div>
            </div>
          </div>
          <p className="mt-3 text-sm font-semibold text-primary">Great Vibes! 🎉</p>
        </div>

        <div className="space-y-4">
          <div className="rounded-2xl border border-border/70 bg-card/50 p-4">
            <p className="mb-3 text-sm font-semibold">Score breakdown</p>
            <div className="space-y-2">
              {scoreBreakdown.map((item) => (
                <div key={item.label} className="flex items-center justify-between gap-3 text-sm">
                  <span className="flex items-center gap-2 text-muted-foreground">
                    <item.icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                    {item.label}
                  </span>
                  <span className="font-medium text-emerald-600 dark:text-emerald-400">+{item.value}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-border/70 bg-card/50 p-4">
            <p className="text-sm font-semibold">What this means</p>
            <p className="mt-1.5 text-sm leading-6 text-muted-foreground">
              You&apos;re seen as reliable, kind, and trustworthy.
            </p>
            <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
              <li>· Higher acceptance from others</li>
              <li>· Priority in plan invites</li>
              <li>· Access to premium features</li>
              <li>· Stronger circle trust</li>
            </ul>
          </div>
        </div>
      </div>

      <section>
        <h2 className="mb-3 text-sm font-semibold">How to improve</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {improveTips.map((tip) => (
            <div key={tip.title} className="rounded-xl border border-border/70 bg-card/50 p-4">
              <p className="text-sm font-semibold">{tip.title}</p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">{tip.description}</p>
              <p className="mt-2 text-xs font-medium text-primary">{tip.points}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
