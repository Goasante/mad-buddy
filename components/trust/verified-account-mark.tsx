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
 * purpose. This one is a warm orange seal with a gold crown; Trusted Member and
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
 * DRAWN FOR 14-20px. The full emblem has scalloped edges, a gloss highlight and
 * a three-dimensional crown; every one of those turns to mush beside a name at
 * this size. The geometry below keeps what survives -- the seal silhouette, the
 * gold ring, the crown's three points, a heavy check -- and drops what does
 * not. It carries currentColor nowhere: the colours ARE the identity.
 */

/** One place for the palette, so the inline mark and the full emblem agree. */
const SEAL_OUTER = "#F97316";
const SEAL_INNER = "#EA580C";
const GOLD = "#FBBF24";
const GOLD_DEEP = "#F59E0B";
const CHECK = "#FFFFFF";

/**
 * The scalloped seal outline.
 *
 * Twelve lobes on the reference; twelve at 16px is a blur, so this uses eight.
 * The silhouette still reads as a seal rather than a plain circle, which is
 * the part that distinguishes it at a glance.
 */
const SEAL_PATH =
  "M12 1.6l2.1 1.5 2.5-.5 1.3 2.2 2.4 1 .1 2.6 1.7 1.9-1.2 2.3.5 2.5-2.2 1.4-1 2.4-2.6.2-1.9 1.7-2.3-1.2-2.5.5-1.4-2.2-2.4-1-.2-2.6L1.6 12l1.2-2.3-.5-2.5 2.2-1.4 1-2.4 2.6-.2L10 1.5l2 .1z";

export function VerifiedAccountMark({
  isVerifiedAccount = false,
  compact = false,
  size,
  className
}: {
  isVerifiedAccount?: boolean;
  /** Icon only, for dense identity rows beside a name. */
  compact?: boolean;
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
      {/* Seal. Two tones rather than a gradient: a gradient at 16px is a flat
          muddy fill, while two solid shapes keep an edge. */}
      <path d={SEAL_PATH} fill={SEAL_OUTER} />
      <circle cx="12" cy="12.4" r="7.4" fill={SEAL_INNER} />

      {/* The gold ring, which is what separates this from a plain orange dot
          at small sizes. */}
      <circle cx="12" cy="12.4" r="6.2" fill="none" stroke={GOLD} strokeWidth="1.5" />

      {/* Crown: three points and three orbs, simplified from the reference.
          Sits above the seal, overlapping slightly so the two read as one
          object rather than a hat balanced on a coin. */}
      <path
        d="M7.4 5.6l1.7 1.9 1.6-2.4 1.6 2.4 1.7-1.9.7 3.1H6.7z"
        fill={GOLD}
        stroke={GOLD_DEEP}
        strokeWidth="0.4"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="3.4" r="1.15" fill={GOLD} />
      <circle cx="7.1" cy="5.2" r="0.85" fill={GOLD} />
      <circle cx="16.9" cy="5.2" r="0.85" fill={GOLD} />

      {/* The check. Deliberately heavy -- it is the one element that must
          survive at 14px, and a thin stroke is the first thing to disappear. */}
      <path
        d="M8.9 12.5l2.1 2.1 4.1-4.4"
        stroke={CHECK}
        strokeWidth="2.4"
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
