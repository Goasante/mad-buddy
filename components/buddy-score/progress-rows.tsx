import type { Route } from "next";
import Image from "next/image";
import Link from "next/link";
import { Award, ChevronRight, Clock3 } from "lucide-react";
import type { MyProgressData } from "@/lib/progress/my-progress";

/**
 * Shared compact row presentation for My Progress and its "View all" /
 * "View activity history" detail views, so the preview on the main page and
 * the full list behind it never drift into two different visual systems.
 */

export function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(new Date(value));
}

/** Compact ~76px achievement row: badge, name, earned date, one-line
 * description. Every badge uses the same bounding box, background field and
 * radius regardless of its source artwork, so a mix of styles still reads
 * as one coherent system. Links into the full gallery at this achievement's
 * card, preserving the old chip rail's deep-link/scroll-to/highlight
 * behaviour without a redundant second list on the page. */
export function AchievementRow({ achievement }: { achievement: MyProgressData["achievements"]["featured"][number] }) {
  return (
    <Link href={`/badges?achievement=${achievement.code}` as Route} className="focus-ring flex min-h-11 items-center gap-3 px-4 py-3 hover:bg-secondary/20">
      <span className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-xl bg-secondary/35" aria-hidden="true">
        {achievement.iconPath ? (
          <Image src={achievement.iconPath} alt="" width={32} height={32} className="h-8 w-8 object-contain" />
        ) : (
          <Award className="h-5 w-5 text-primary" />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-foreground">{achievement.name}</p>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">Earned {formatDate(achievement.earnedAt)}</p>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">{achievement.description}</p>
      </div>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
    </Link>
  );
}

export function ActivityRow({ item }: { item: MyProgressData["timeline"][number] }) {
  return (
    <div className="flex min-h-11 items-center gap-3 px-4 py-3">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-secondary/35" aria-hidden="true">
        {item.kind === "achievement" ? <Award className="h-4 w-4 text-primary" /> : <Clock3 className="h-4 w-4 text-muted-foreground" />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">{item.label}</p>
        <p className="text-xs text-muted-foreground">{item.detail} &middot; {formatDate(item.occurredAt)}</p>
      </div>
      {item.points !== null ? <PointDelta points={item.points} /> : null}
    </div>
  );
}

export function PointDelta({ points }: { points: number }) {
  // Positive/negative/neutral are all real outcomes in the ledger (a
  // confirmed moderation penalty subtracts points), so the delta needs its
  // own semantic colour rather than assuming every event is a reward -- and
  // the sign itself is printed, not just implied by colour.
  const tone = points > 0 ? "text-emerald-500" : points < 0 ? "text-red-500" : "text-muted-foreground";
  return <span className={`shrink-0 text-sm font-semibold tabular-nums ${tone}`}>{points > 0 ? "+" : ""}{points}</span>;
}
