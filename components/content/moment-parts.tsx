"use client";

import * as Popover from "@radix-ui/react-popover";
import { Clock, Eye, Maximize2, Plus } from "lucide-react";
import { useEffect, useState, useTransition } from "react";
import { MomentImage } from "@/components/ui/moment-image";
import { TuneInIcon } from "@/components/content/tune-in-icon";
import { UserAvatar } from "@/components/ui/user-avatar";
import { publicMembershipTier } from "@/lib/billing/premium-identity";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import {
  MOMENT_REACTIONS,
  reactionEmoji,
  summarizeReactions,
  tunedInCountLabel,
  type MomentReactionId
} from "@/lib/content/moments";
import type { VisibleMoment } from "@/lib/content/service";
import { PremiumPlanBadge } from "@/components/premium/premium-plan-badge";
import { cn } from "@/lib/utils";

/**
 * Shared Moments presentation.
 *
 * Two product rules are enforced here rather than left to each caller:
 *  - Engagement is positive only. The reaction picker is built from the
 *    canonical set, so there is no code path that can render a dislike.
 *  - Reach and attributed tune-ins are author-only. Those fields arrive as
 *    `null` for other viewers, and the components simply have nothing to draw,
 *    so a card cannot become a scoreboard of someone else's numbers.
 */

/** "2h left" / "18m left". Display only; access control is server-side. */
export function timeRemainingLabel(expiresAt: string, nowMs: number): string {
  const remaining = Date.parse(expiresAt) - nowMs;
  if (!Number.isFinite(remaining) || remaining <= 0) return "Expired";
  const minutes = Math.round(remaining / 60_000);
  if (minutes < 60) return `${Math.max(1, minutes)}m left`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours}h left` : `${hours}h ${rest}m left`;
}

/** A clock that ticks each minute so "2h left" stays honest without polling. */
export function useMomentClock(): number {
  // Lazy initialiser: reading Date.now() in a component body is impure.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const interval = window.setInterval(() => setNowMs(Date.now()), 60_000);
    return () => window.clearInterval(interval);
  }, []);
  return nowMs;
}

// ---------------------------------------------------------------------------
// Reactions
// ---------------------------------------------------------------------------

/**
 * Compact aggregate + picker. Tapping opens the positive reaction set; choosing
 * one replaces any existing reaction rather than stacking a second, matching the
 * one-row-per-user-per-Moment constraint in the database.
 */
export function ReactionControl({
  moment,
  pending,
  onReact,
  onRemove
}: {
  moment: VisibleMoment;
  pending: boolean;
  onReact: (reaction: MomentReactionId) => void;
  onRemove: () => void;
}) {
  const [open, setOpen] = useState(false);
  const summary = summarizeReactions(moment.reactionBreakdown);

  return (
    <Popover.Root open={open} onOpenChange={setOpen} modal={false}>
      <Popover.Trigger asChild>
        <button
          type="button"
          disabled={pending}
          aria-label={moment.myReaction ? "Change your reaction" : "Add a reaction"}
          className={cn(
            "focus-ring safe-motion inline-flex min-h-9 items-center gap-1.5 rounded-full border px-2.5 text-sm font-semibold",
            moment.myReaction
              ? "border-orange-400/40 bg-orange-400/12 text-orange-700 dark:text-orange-200"
              : "border-border bg-card/60 text-muted-foreground hover:bg-secondary"
          )}
        >
          {summary.entries.length > 0 ? (
            <span aria-hidden="true">{summary.entries.map((entry) => entry.emoji).join("")}</span>
          ) : (
            <span aria-hidden="true">{reactionEmoji("heart")}</span>
          )}
          {summary.total > 0 ? <span className="tabular-nums">{summary.total.toLocaleString()}</span> : null}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        {/* side="top" with collisionPadding: flips below automatically when
            there is not enough room above, so the picker is never clipped. */}
        <Popover.Content
          side="top"
          align="start"
          sideOffset={8}
          collisionPadding={12}
          aria-label="Choose a reaction"
          className="z-50 flex gap-0.5 rounded-full border border-border bg-card/95 p-1 shadow-lg supports-[backdrop-filter]:bg-card/90"
        >
          {MOMENT_REACTIONS.map((reaction) => (
            <button
              key={reaction.id}
              type="button"
              aria-label={reaction.label}
              aria-pressed={moment.myReaction === reaction.id}
              disabled={pending}
              onClick={() => {
                setOpen(false);
                // Tapping the active reaction clears it; anything else replaces it.
                if (moment.myReaction === reaction.id) onRemove();
                else onReact(reaction.id);
              }}
              className={cn(
                "focus-ring safe-motion grid h-11 w-11 place-items-center rounded-full text-lg",
                moment.myReaction === reaction.id ? "bg-orange-400/20" : "hover:bg-secondary"
              )}
            >
              <span aria-hidden="true">{reaction.emoji}</span>
            </button>
          ))}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

// ---------------------------------------------------------------------------
// Tune In
// ---------------------------------------------------------------------------

/**
 * One-way interest. Optimistic on purpose: the action is idempotent and silent,
 * so a tap should feel instant, and a failure simply reverts.
 *
 * The creator is never notified, so this control does not promise them anything.
 */
export function TuneInButton({
  creatorId,
  sourceMomentId,
  tunedIn,
  size = "md",
  onTuneIn,
  onTuneOut
}: {
  creatorId: string;
  sourceMomentId?: string;
  tunedIn: boolean;
  size?: "sm" | "md";
  onTuneIn: (creatorId: string, sourceMomentId?: string) => Promise<boolean>;
  onTuneOut: (creatorId: string) => Promise<boolean>;
}) {
  const [optimistic, setOptimistic] = useState<boolean | null>(null);
  const [isPending, startTransition] = useTransition();
  const active = optimistic ?? tunedIn;

  return (
    <button
      type="button"
      disabled={isPending}
      aria-pressed={active}
      onClick={() =>
        startTransition(async () => {
          const next = !active;
          setOptimistic(next);
          const ok = next ? await onTuneIn(creatorId, sourceMomentId) : await onTuneOut(creatorId);
          // Revert on failure; otherwise let the server state take over.
          setOptimistic(ok ? null : !next);
        })
      }
      className={cn(
        "focus-ring safe-motion inline-flex items-center gap-1.5 rounded-full border font-semibold",
        size === "sm" ? "min-h-8 px-2.5 text-xs" : "min-h-9 px-3 text-sm",
        active
          ? "border-emerald-400/40 bg-emerald-400/12 text-emerald-700 dark:text-emerald-300"
          : "border-transparent bg-orange-500 text-white hover:bg-orange-600"
      )}
    >
      <TuneInIcon className={size === "sm" ? "h-3.5 w-3.5 shrink-0" : "h-4 w-4 shrink-0"} />
      {active ? "Tuned In" : "Tune In"}
    </button>
  );
}

/** "428 Tuned In". Never "followers", and there is no "following" counterpart. */
export function TunedInCount({ count, className }: { count: number; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-xs text-muted-foreground", className)}>
      <TuneInIcon className="h-3.5 w-3.5 shrink-0" />
      {tunedInCountLabel(count)}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Author-only insights
// ---------------------------------------------------------------------------

/**
 * Reach for the author of a Moment. Renders nothing unless the viewer IS the
 * author, because `viewCount` and `tunedInFromThis` are null for everyone else.
 */
export function AuthorInsights({ moment }: { moment: VisibleMoment }) {
  if (!moment.isAuthor || moment.viewCount === null) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
      <span className="inline-flex items-center gap-1">
        <Eye className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span className="tabular-nums">{moment.viewCount.toLocaleString()}</span> seen
      </span>
      <span className="inline-flex items-center gap-1">
        <span aria-hidden="true">❤️</span>
        <span className="tabular-nums">{moment.reactionCount.toLocaleString()}</span>
      </span>
      {moment.tunedInFromThis && moment.tunedInFromThis > 0 ? (
        // People who discovered the author through THIS Moment. A count only:
        // the author never learns who they are.
        <span className="inline-flex items-center gap-1 font-semibold text-orange-600 dark:text-orange-300">
          <TuneInIcon className="h-3.5 w-3.5 shrink-0" />+
          {moment.tunedInFromThis.toLocaleString()} Tuned In
        </span>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Avatar ring row
// ---------------------------------------------------------------------------

export type RingEntry = {
  authorId: string;
  name: string;
  avatarUrl: string | null;
  momentCount: number;
  hasUnseen: boolean;
};

/**
 * The horizontal row of Muddies with live Moments.
 *
 * The "has something new" ring is a Mad Buddy gradient (orange into violet)
 * rather than a copy of any other app's, and it is a static gradient with a slow
 * optional shimmer instead of a spinner.
 */
export function MomentsRing({
  entries,
  onOpenAuthor,
  onCreate,
  selfAvatarUrl,
  selfName
}: {
  entries: RingEntry[];
  onOpenAuthor: (authorId: string) => void;
  onCreate: () => void;
  selfAvatarUrl: string | null;
  selfName: string;
}) {
  const reducedMotion = useReducedMotion();
  const own = entries.find((entry) => entry.name === "You");
  const others = entries.filter((entry) => entry.name !== "You");

  return (
    <div className="-mx-4 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
      <ul className="flex w-max gap-3.5">
        <li>
          {/* Own row doubles as the create affordance when nothing is live. */}
          <button
            type="button"
            onClick={own ? () => onOpenAuthor(own.authorId) : onCreate}
            className="focus-ring safe-motion flex w-[4.25rem] flex-col items-center gap-1.5"
            aria-label={own ? "Your Moments" : "Share a Moment"}
          >
            <span className="relative">
              <span
                className={cn(
                  "moment-ring grid place-items-center rounded-full p-[2px]",
                  own?.hasUnseen && !reducedMotion && "moment-ring-live",
                  !own && "moment-ring-idle"
                )}
              >
                <span className="rounded-full bg-background p-[2px]">
                  <UserAvatar src={selfAvatarUrl} name={selfName} size="md" decorative />
                </span>
              </span>
              {!own ? (
                <span
                  className="absolute -bottom-0.5 -right-0.5 grid h-5 w-5 place-items-center rounded-full bg-orange-500 text-white ring-2 ring-background"
                  aria-hidden="true"
                >
                  <Plus className="h-3 w-3" strokeWidth={3} />
                </span>
              ) : null}
            </span>
            <span className="w-full truncate text-center text-[0.6875rem] font-medium">
              {own ? "Your Moment" : "Add"}
            </span>
          </button>
        </li>

        {others.map((entry) => (
          <li key={entry.authorId}>
            <button
              type="button"
              onClick={() => onOpenAuthor(entry.authorId)}
              className="focus-ring safe-motion flex w-[4.25rem] flex-col items-center gap-1.5"
              aria-label={`${entry.name}, ${entry.momentCount} ${entry.momentCount === 1 ? "Moment" : "Moments"}${entry.hasUnseen ? ", new" : ""}`}
            >
              <span
                className={cn(
                  "moment-ring grid place-items-center rounded-full p-[2px]",
                  entry.hasUnseen ? (reducedMotion ? "" : "moment-ring-live") : "moment-ring-seen"
                )}
              >
                <span className="rounded-full bg-background p-[2px]">
                  <UserAvatar src={entry.avatarUrl} name={entry.name} size="md" decorative />
                </span>
              </span>
              <span className="w-full truncate text-center text-[0.6875rem] font-medium">
                {entry.name.split(" ")[0]}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Media
// ---------------------------------------------------------------------------

/**
 * Image-first media frame.
 *
 * `loading="lazy"` and `decoding="async"` come from MomentImage; the server
 * already signs the 1080px `feed` variant rather than the original, so a 4K
 * upload is never shipped to render a feed card. A fixed aspect ratio reserves
 * layout space so the feed does not jump as images arrive.
 */
export function MomentMedia({
  moment,
  onRetry,
  aspect = "square",
  priority = false,
  onOpenFullScreen
}: {
  moment: VisibleMoment;
  onRetry: () => void;
  aspect?: "square" | "portrait";
  priority?: boolean;
  /** Tapping the media opens it full-screen. Omitted where that is not offered. */
  onOpenFullScreen?: () => void;
}) {
  // Legacy Moments may be text or video. This phase creates images only, but
  // anything already posted still has to render rather than vanish.
  if (moment.contentType === "text") {
    return (
      <div className="rounded-[1rem] bg-secondary/40 px-4 py-5">
        <p className="whitespace-pre-wrap text-sm leading-6">{moment.textContent}</p>
      </div>
    );
  }

  if (moment.contentType === "video") {
    if (!moment.mediaUrl) return null;
    return (
      <div className="relative">
        <video
          src={moment.mediaUrl}
          controls
          playsInline
          preload="metadata"
          className={cn("w-full rounded-[1rem] bg-black object-cover", aspect === "square" ? "aspect-square" : "aspect-[4/5]")}
        />
        {/* A separate control rather than a wrapper: wrapping the <video> would
            swallow play/pause and seeking. */}
        {onOpenFullScreen ? (
          <button
            type="button"
            onClick={onOpenFullScreen}
            aria-label="View video full screen"
            className="focus-ring absolute right-2 top-2 grid h-9 w-9 place-items-center rounded-full bg-black/55 text-white backdrop-blur-sm"
          >
            <Maximize2 className="h-4 w-4" aria-hidden="true" />
          </button>
        ) : null}
      </div>
    );
  }

  const image = (
    <MomentImage
      src={moment.mediaUrl}
      alt={moment.caption?.trim() || `Moment from ${moment.authorName}`}
      onRetry={onRetry}
      className={cn(
        "w-full rounded-[1rem] bg-secondary/40 object-cover",
        aspect === "square" ? "aspect-square" : "aspect-[4/5]"
      )}
      fallbackClassName={cn("rounded-[1rem]", aspect === "square" ? "aspect-square" : "aspect-[4/5]")}
      priority={priority}
    />
  );

  if (!onOpenFullScreen) return image;

  return (
    <button
      type="button"
      onClick={onOpenFullScreen}
      aria-label={`View ${moment.caption?.trim() || `Moment from ${moment.authorName}`} full screen`}
      className="focus-ring block w-full rounded-[1rem]"
    >
      {image}
    </button>
  );
}

/**
 * "ON AIR": a creator currently has an active public Air Moment.
 *
 * Not livestreaming and not a viewer count, just a status. Derived entirely
 * from existing Moment status/expiry data (no new field), so it is only ever
 * shown where that is already known to be true.
 */
export function OnAirBadge({ className }: { className?: string }) {
  const reducedMotion = useReducedMotion();
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border border-red-500/30 bg-red-500/10 px-1.5 py-0.5 text-[0.625rem] font-bold uppercase tracking-wide text-red-600 dark:text-red-400",
        className
      )}
    >
      <span
        className={cn("h-1.5 w-1.5 shrink-0 rounded-full bg-red-500", !reducedMotion && "on-air-pulse")}
        aria-hidden="true"
      />
      <span aria-hidden="true">ON AIR</span>
      <span className="sr-only">Currently on Air</span>
    </span>
  );
}

/** Small header row shared by both card styles. */
export function MomentHeader({
  moment,
  nowMs,
  onOpenCreator,
  onAir = false,
  children
}: {
  moment: VisibleMoment;
  nowMs: number;
  onOpenCreator?: (creatorId: string) => void;
  /** Shows the ON AIR badge beside the name. */
  onAir?: boolean;
  children?: React.ReactNode;
}) {
  const nameNode = (
    <span className="min-w-0">
      <span className="flex items-center gap-1.5">
        <span className="min-w-0 truncate text-sm font-semibold">{moment.authorName}</span>
        <PremiumPlanBadge plan={moment.authorPlan} compact />
        {onAir ? <OnAirBadge /> : null}
      </span>
      <span className="flex items-center gap-1 text-[0.6875rem] text-muted-foreground">
        <Clock className="h-3 w-3 shrink-0" aria-hidden="true" />
        {timeRemainingLabel(moment.expiresAt, nowMs)}
      </span>
    </span>
  );

  return (
    <div className="flex items-center gap-2.5">
      {onOpenCreator && !moment.isAuthor ? (
        <button
          type="button"
          onClick={() => onOpenCreator(moment.authorId)}
          className="focus-ring safe-motion flex min-w-0 flex-1 items-center gap-2.5 rounded-full pr-2 text-left"
          aria-label={`Open ${moment.authorName}'s Moments`}
        >
          <UserAvatar src={moment.authorAvatarUrl} name={moment.authorName} size="sm" decorative membershipTier={publicMembershipTier(moment.authorPlan)} />
          {nameNode}
        </button>
      ) : (
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          <UserAvatar src={moment.authorAvatarUrl} name={moment.authorName} size="sm" decorative membershipTier={publicMembershipTier(moment.authorPlan)} />
          {nameNode}
        </div>
      )}
      {children}
    </div>
  );
}
