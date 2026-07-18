"use client";

import Link from "next/link";
import type { Route } from "next";
import { Hand, MapPin, CalendarClock, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

type PulseSummaryData = {
  nearbyCount: number;
  unreadWaves: number;
  pendingPings: number;
  pendingPlans: number;
};

type Stat = { key: string; icon: typeof Hand; label: (n: number) => string; count: number; href: Route };

/**
 * The Pulse summary strip (feature spec batch 4). Fetches the one aggregated
 * /api/pulse response and shows an action-oriented summary, never raw data,
 * never a feed. Quiet by design when nothing is happening (spec §7).
 */
export function PulseSummary() {
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [summary, setSummary] = useState<PulseSummaryData | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch("/api/pulse", { credentials: "include", cache: "no-store" });
        if (!response.ok) throw new Error("pulse failed");
        const data = (await response.json()) as { summary: PulseSummaryData };
        if (!cancelled) {
          setSummary(data.summary);
          setState("ready");
        }
      } catch {
        if (!cancelled) setState("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (state === "loading") {
    return <div className="h-16 animate-pulse rounded-2xl bg-card/55 motion-reduce:animate-none dark:bg-white/[0.035]" aria-hidden="true" />;
  }
  if (state === "error" || !summary) return null;

  const stats: Stat[] = [
    { key: "nearby", icon: MapPin, count: summary.nearbyCount, href: "/friends" as Route, label: (n) => `${n} nearby` },
    { key: "waves", icon: Hand, count: summary.unreadWaves, href: "/notifications" as Route, label: (n) => `${n} ${n === 1 ? "wave" : "waves"}` },
    { key: "pings", icon: Sparkles, count: summary.pendingPings, href: "/notifications" as Route, label: (n) => `${n} ${n === 1 ? "ping" : "pings"}` },
    { key: "plans", icon: CalendarClock, count: summary.pendingPlans, href: "/plans" as Route, label: (n) => `${n} ${n === 1 ? "plan needs a reply" : "plans need a reply"}` }
  ];
  const active = stats.filter((stat) => stat.count > 0);

  if (active.length === 0) {
    return (
      <section className="rounded-2xl border border-border/60 bg-card/55 p-4 dark:bg-white/[0.035]" aria-label="Your Pulse">
        <p className="text-sm font-medium">Your Pulse is quiet right now.</p>
        <p className="mt-1 text-xs text-muted-foreground">
          <Link href="/hangout-mode" className="text-primary underline-offset-2 hover:underline">Start Hangout Mode</Link>
          {" or "}
          <Link href="/plans?create=1" className="text-primary underline-offset-2 hover:underline">create a plan</Link>
          {" to get things going."}
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-2xl border border-border/60 bg-card/55 p-4 dark:bg-white/[0.035]" aria-label="Your Pulse">
      <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Your Pulse</p>
      <div className="flex flex-wrap gap-2">
        {active.map((stat) => (
          <Link
            key={stat.key}
            href={stat.href}
            className={cn(
              "focus-ring safe-motion inline-flex items-center gap-1.5 rounded-full border border-border bg-background/60 px-3 py-1.5 text-sm font-medium hover:bg-secondary"
            )}
          >
            <stat.icon className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
            {stat.label(stat.count)}
          </Link>
        ))}
      </div>
    </section>
  );
}
