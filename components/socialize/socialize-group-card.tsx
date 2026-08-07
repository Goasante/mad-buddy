"use client";

import type { Route } from "next";
import Link from "next/link";
import { Check, Lock, Plus, UsersRound } from "lucide-react";
import { memo, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import type { GroupSummary } from "@/lib/groups/types";
import { groupActivityLabel, groupCoverFor, groupJoinState } from "@/lib/groups/discovery";
import { cn } from "@/lib/utils";

/**
 * One group in Socialize discovery.
 *
 * Landscape-first, unlike the person card. A person is a portrait — the face
 * IS the content — while a group is a place, and a wide cover with the name
 * sitting under it reads as somewhere you could walk into. It also lets three
 * cards share a rail without the name truncating to two words.
 *
 * Every field is real. There are no interests, no trending score, no
 * engagement metric and no "popular" badge, because none of those exist in the
 * projection; a card that invents them is selling a community that may not be
 * there.
 *
 * Memoised — the rail re-renders on filter and search keystrokes, and a
 * group's props are stable.
 */

export type SocializeGroupCardProps = {
  group: GroupSummary;
  onJoin: (group: GroupSummary) => void;
  pending?: boolean;
  /**
   * Future slots. Rendered only when a caller passes real content, so Nearby
   * Groups, Spark, Event Groups and recommendation context have somewhere to
   * land without any of them being stubbed in today.
   */
  slots?: { afterMeta?: ReactNode };
};

function GroupCard({ group, onJoin, pending = false, slots }: SocializeGroupCardProps) {
  const href = `/groups/${group.id}` as Route;
  const cover = groupCoverFor(group);
  const activity = groupActivityLabel(group.lastMessageAt);
  const join = groupJoinState(group);

  return (
    <article
      aria-label={`${group.name}, ${group.memberCount} ${group.memberCount === 1 ? "member" : "members"}`}
      className={cn(
        "group relative flex h-full flex-col overflow-hidden rounded-3xl",
        "border border-border/60 bg-card/50",
        // The signature glow: a warm edge that lifts on hover. Never a ring.
        "shadow-[0_0_0_1px_hsl(var(--primary)/0.06),0_10px_30px_-18px_hsl(var(--primary)/0.35)]",
        "transition-shadow duration-300 ease-out motion-reduce:transition-none",
        "hover:shadow-[0_0_0_1px_hsl(var(--primary)/0.14),0_16px_40px_-18px_hsl(var(--primary)/0.5)]"
      )}
    >
      <Link
        href={href}
        aria-label={`Open ${group.name}`}
        className="focus-ring relative block aspect-[16/10] w-full overflow-hidden"
      >
        {/* GENERATED COVER.
            No group has an uploaded image today — `image_media_id` exists in
            the schema but nothing populates it — so rather than a grey box,
            each group gets a deterministic gradient derived from its own id.
            The same group always looks the same, and two groups side by side
            almost never match. */}
        <span
          aria-hidden="true"
          className="absolute inset-0"
          style={{ background: cover.gradient }}
        />
        <span
          aria-hidden="true"
          className="absolute inset-0 bg-[radial-gradient(120%_120%_at_20%_0%,rgb(255_255_255/0.18),transparent_60%)]"
        />
        <span
          aria-hidden="true"
          className={cn(
            "absolute inset-0 grid place-items-center text-3xl font-bold tracking-tight text-white/90",
            "transition-transform duration-300 ease-out group-hover:scale-[1.03]",
            "motion-reduce:transition-none motion-reduce:group-hover:scale-100"
          )}
        >
          {cover.initials}
        </span>

        {activity ? (
          <span className="pointer-events-none absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full bg-background/85 px-2.5 py-1 text-[11px] font-semibold backdrop-blur-sm">
            {activity === "Active today" ? (
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden="true" />
            ) : null}
            {activity}
          </span>
        ) : null}
      </Link>

      <div className="flex flex-1 flex-col gap-1 p-4">
        <Link href={href} className="focus-ring truncate text-[0.9375rem] font-semibold hover:underline">
          {group.name}
        </Link>

        {/* Only when they wrote one. */}
        {group.description ? (
          <p className="line-clamp-2 text-xs leading-5 text-muted-foreground">{group.description}</p>
        ) : null}

        <p className="flex items-center gap-1.5 pt-0.5 text-xs text-muted-foreground">
          <UsersRound className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {group.memberCount} {group.memberCount === 1 ? "member" : "members"}
        </p>

        {slots?.afterMeta}

        <div className="mt-auto pt-3">
          {/* The CTA reflects what the SERVER will actually do. A closed group
              shows "Invite only" and is disabled rather than offering a Join
              that would be refused. */}
          <Button
            type="button"
            variant={join.kind === "join" ? "primary" : "outline"}
            className="min-h-[44px] w-full"
            disabled={pending || join.disabled}
            onClick={() => onJoin(group)}
          >
            {join.kind === "joined" ? (
              <Check className="h-4 w-4" aria-hidden="true" />
            ) : join.kind === "invite_only" ? (
              <Lock className="h-4 w-4" aria-hidden="true" />
            ) : (
              <Plus className="h-4 w-4" aria-hidden="true" />
            )}
            {join.label}
          </Button>
        </div>
      </div>
    </article>
  );
}

export const SocializeGroupCard = memo(GroupCard);

/** Card-shaped skeleton, matching the real card so arrivals cause no reflow. */
export function SocializeGroupCardSkeleton() {
  return (
    <div
      aria-hidden="true"
      className="flex h-full flex-col overflow-hidden rounded-3xl border border-border/60 bg-card/50"
    >
      <div className="aspect-[16/10] w-full animate-pulse bg-secondary/50 motion-reduce:animate-none" />
      <div className="flex flex-1 flex-col gap-2 p-4">
        <div className="h-4 w-2/3 animate-pulse rounded bg-secondary/50 motion-reduce:animate-none" />
        <div className="h-3 w-full animate-pulse rounded bg-secondary/40 motion-reduce:animate-none" />
        <div className="mt-auto pt-3">
          <div className="h-11 w-full animate-pulse rounded-xl bg-secondary/40 motion-reduce:animate-none" />
        </div>
      </div>
    </div>
  );
}
