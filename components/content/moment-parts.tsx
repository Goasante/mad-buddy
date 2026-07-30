"use client";

import { Check, Clock, Eye, Plus, Radio, Sparkles } from "lucide-react";
import { useEffect, useRef, useState, useTransition } from "react";
import { MomentImage } from "@/components/ui/moment-image";
import { UserAvatar } from "@/components/ui/user-avatar";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import {
  MOMENT_REACTIONS,
  summarizeReactions,
  tunedInCountLabel,
  type MomentReactionId
} from "@/lib/content/moments";
import type { VisibleMoment } from "@/lib/content/service";
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
  const containerRef = useRef<HTMLDivElement>(null);
  const summary = summarizeReactions(moment.reactionBreakdown);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative flex items-center gap-2">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        disabled={pending}
        aria-expanded={open}
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
          <span aria-hidden="true">❤️</span>
        )}
        {summary.total > 0 ? <span className="tabular-nums">{summary.total.toLocaleString()}</span> : null}
      </button>

      {open ? (
        <div
          role="menu"
          aria-label="Choose a reaction"
          className="absolute bottom-full left-0 z-20 mb-2 flex gap-0.5 rounded-full border border-border bg-card/95 p-1 shadow-lg supports-[backdrop-filter]:bg-card/90"
        >
          {MOMENT_REACTIONS.map((reaction) => (
            <button
              key={reaction.id}
              type="button"
              role="menuitemradio"
              aria-label={reaction.label}
              aria-checked={moment.myReaction === reaction.id}
              disabled={pending}
              onClick={() => {
                setOpen(false);
                // Tapping the active reaction clears it; anything else replaces it.
                if (moment.myReaction === reaction.id) onRemove();
                else onReact(reaction.id);
              }}
              className={cn(
                "focus-ring safe-motion grid h-9 w-9 place-items-center rounded-full text-lg",
                moment.myReaction === reaction.id ? "bg-orange-400/20" : "hover:bg-secondary"
              )}
            >
              <span aria-hidden="true">{reaction.emoji}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
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
      {active ? (
        <>
          <Check className={size === "sm" ? "h-3 w-3" : "h-3.5 w-3.5"} aria-hidden="true" />
          Tuned In
        </>
      ) : (
        <>
          <Plus className={size === "sm" ? "h-3 w-3" : "h-3.5 w-3.5"} aria-hidden="true" />
          Tune In
        </>
      )}
    </button>
  );
}

/** "428 Tuned In". Never "followers", and there is no "following" counterpart. */
export function TunedInCount({ count, className }: { count: number; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-xs text-muted-foreground", className)}>
      <Radio className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
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
          <Sparkles className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />+
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
  priority = false
}: {
  moment: VisibleMoment;
  onRetry: () => void;
  aspect?: "square" | "portrait";
  priority?: boolean;
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
    return moment.mediaUrl ? (
      <video
        src={moment.mediaUrl}
        controls
        playsInline
        preload="metadata"
        className={cn("w-full rounded-[1rem] bg-black object-cover", aspect === "square" ? "aspect-square" : "aspect-[4/5]")}
      />
    ) : null;
  }

  return (
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
}

/** Small header row shared by both card styles. */
export function MomentHeader({
  moment,
  nowMs,
  onOpenCreator,
  children
}: {
  moment: VisibleMoment;
  nowMs: number;
  onOpenCreator?: (creatorId: string) => void;
  children?: React.ReactNode;
}) {
  const nameNode = (
    <span className="min-w-0">
      <span className="block truncate text-sm font-semibold">{moment.authorName}</span>
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
          <UserAvatar src={moment.authorAvatarUrl} name={moment.authorName} size="sm" decorative />
          {nameNode}
        </button>
      ) : (
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          <UserAvatar src={moment.authorAvatarUrl} name={moment.authorName} size="sm" decorative />
          {nameNode}
        </div>
      )}
      {children}
    </div>
  );
}
