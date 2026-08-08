import { ShieldCheck } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * The Trusted Member mark.
 *
 * WHAT IT MEANS: a long-standing member who has completed every journey and
 * whom staff approved. WHAT IT DOES NOT MEAN: that Mad Buddy checked anyone's
 * identity. The wording is "Trusted Member" everywhere — never "Verified" —
 * because a tick earned by tenure would tell every other user something about
 * this person that nobody actually confirmed.
 *
 * Deliberately NOT the premium badge's shape or palette. Premium is a plan
 * someone pays for; this is standing they earned, and two marks that looked
 * alike would be read as two tiers of the same thing. A shield in the brand
 * maroon, against premium's orange and indigo pills.
 *
 * Absent from Linkr discovery cards on purpose: those cards are about the
 * person, their proximity and one action, and every extra mark competes with
 * that. It appears where identity context is the point — full profiles,
 * conversations, member lists.
 */

export function TrustedMemberMark({
  /** The approval timestamp, or null. Null renders nothing. */
  trustedSince,
  compact = false,
  className
}: {
  trustedSince?: string | null;
  compact?: boolean;
  className?: string;
}) {
  if (!trustedSince) return null;

  return (
    <span
      // Titled rather than aria-hidden: the mark carries meaning, so a screen
      // reader should say what it is rather than skip it or read "image".
      title="Trusted Member"
      aria-label="Trusted Member"
      role="img"
      className={cn(
        "trusted-member-mark inline-flex h-5 shrink-0 items-center gap-1 whitespace-nowrap rounded-full border px-1.5 text-[10px] font-bold leading-none tracking-wide",
        "border-[hsl(var(--shadow)/0.35)] bg-[hsl(var(--shadow)/0.08)] text-[hsl(var(--shadow))]",
        "dark:border-white/25 dark:bg-white/10 dark:text-white/90",
        className
      )}
    >
      <ShieldCheck className="h-3 w-3" aria-hidden="true" />
      {/* Compact drops the word where space is tight — a message header, a
          dense member row — but never the icon, so the mark is still
          recognisable at a glance. */}
      {compact ? null : "Trusted"}
    </span>
  );
}
