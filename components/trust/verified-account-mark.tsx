"use client";

import * as Popover from "@radix-ui/react-popover";
import { useState, type ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * The Verified Account mark.
 *
 * THREE SEPARATE SIGNALS, and this is only one of them:
 *
 *   Verified Account -- Mad Buddy has verified this account.
 *   Trusted Member   -- standing earned through the product.
 *   Premium          -- a Plus/Pro subscription.
 *
 * A person may hold any combination, so the three are drawn differently on
 * purpose. This one is a warm orange seal with a clear white check; Trusted Member and
 * Premium keep their own treatments. Nothing here reads plan, tenure or journey
 * progress -- verification comes from account_verifications and only from
 * there.
 *
 * WHY A HAND-DRAWN SVG RATHER THAN AN ICON FROM THE SET:
 *
 * This previously rendered Lucide's BadgeCheck in sky blue, which read as the
 * check every other social product uses. The mark needs to look like Mad Buddy
 * and to be unmistakable against the other two identity signals, and no
 * generic glyph does that.
 *
 * DRAWN FOR 16-20px. Eight shallow lobes and one heavy check remain legible
 * beside a name, including against a dark card. This is the approved vector
 * proposal, rendered inline so every surface uses the same crisp shape.
 */

/** One place for the palette, so the inline mark and the full emblem agree. */
const SEAL_OUTER = "#F97316";
const SEAL_INNER = "#E85D10";
const GOLD = "#FFD05C";
const CHECK = "#FFFDF8";
const LOBES = [
  [19.75, 12], [17.48, 17.48], [12, 19.75], [6.52, 17.48],
  [4.25, 12], [6.52, 6.52], [12, 4.25], [17.48, 6.52]
] as const;

export function VerifiedAccountMark({
  isVerifiedAccount = false,
  compact = false,
  inControl = false,
  size,
  className
}: {
  isVerifiedAccount?: boolean;
  /** Icon only, for dense identity rows beside a name. */
  compact?: boolean;
  /** Non-interactive emblem when the surrounding name is already a control. */
  inControl?: boolean;
  /** Pixel size of the glyph. Defaults to 16 inline, 18 with a label. */
  size?: number;
  className?: string;
}) {
  // Renders nothing at all when unverified, so no caller needs to branch and
  // no layout reserves space for a mark that is not there.
  if (!isVerifiedAccount) return null;

  const glyphSize = size ?? (compact ? 16 : 18);

  const glyph = (
    <svg
      width={glyphSize}
      height={glyphSize}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className="shrink-0"
    >
      <g fill={SEAL_OUTER}>
        {LOBES.map(([cx, cy]) => <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="3.15" />)}
        <circle cx="12" cy="12" r="9.55" />
      </g>
      <circle cx="12" cy="12" r="8.25" fill={SEAL_INNER} stroke={GOLD} strokeWidth="1.45" />
      <path
        d="M7.4 12.05 10.55 15.1 16.95 8.9"
        stroke={CHECK}
        strokeWidth="2.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );

  // COMPACT: a tappable glyph that explains itself.
  //
  // A `title` alone was desktop-only -- it needs a hover, which a phone cannot
  // produce, so on mobile the mark was unexplained. CompactMark makes it a real
  // button in a popover, reachable by tap, click and keyboard alike.
  if (compact && inControl) {
    return <span role="img" aria-label="Verified account" title="Mad Buddy has verified this account." className={cn("inline-flex shrink-0 items-center", className)}>{glyph}</span>;
  }
  if (compact) {
    return <CompactMark glyph={glyph} className={className} />;
  }

  // FULL: glyph plus wording, for profile and celebration surfaces where there
  // is room to say what the mark means rather than relying on recognition.
  return (
    <span
      title="Mad Buddy has verified this account."
      className={cn(
        "inline-flex h-6 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-2 text-[11px] font-semibold leading-none",
        "border-[#F97316]/35 bg-[#F97316]/10 text-[#C2410C] dark:border-[#FBBF24]/30 dark:bg-[#F97316]/15 dark:text-[#FDBA74]",
        className
      )}
    >
      {glyph}
      {/* The label carries the meaning here, so the glyph is decorative and
          a screen reader hears the phrase once rather than twice. */}
      Verified
    </span>
  );
}

/**
 * The tappable inline mark.
 *
 * Split into its own component because hooks cannot live behind the early
 * `return null` in the exported one -- and that early return is worth keeping,
 * since it means no caller branches on verification and no layout reserves
 * space for a mark that is not there.
 */
function CompactMark({ glyph, className }: { glyph: ReactNode; className?: string }) {
  const [open, setOpen] = useState(false);

  return (
    <Popover.Root open={open} onOpenChange={setOpen} modal={false}>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label="Verified account. Tap for details."
          onClick={(event) => {
            // The mark frequently sits inside a card or row that navigates on
            // tap. Without this, explaining the badge would open somebody's
            // profile instead.
            event.preventDefault();
            event.stopPropagation();
          }}
          className={cn(
            "focus-ring inline-flex shrink-0 items-center rounded-full align-middle",
            className
          )}
        >
          {glyph}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="top"
          align="center"
          sideOffset={6}
          collisionPadding={12}
          className="z-50 max-w-[15rem] rounded-xl border border-border bg-card/95 p-3 text-left shadow-lg supports-[backdrop-filter]:bg-card/90"
        >
          <p className="text-sm font-semibold">Verified account</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {/* Says exactly what was done and nothing more. Not "safe", not
                "trusted", not "official" -- those are different claims, and
                Trusted Member is a separate signal with its own meaning. */}
            Mad Buddy has verified this account.
          </p>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
