"use client";

import type { Route } from "next";
import Link from "next/link";
import { MessageCircle } from "lucide-react";
import { memo, type ReactNode } from "react";
import { FeatureIcon } from "@/components/ui/feature-icon";
import { GlowAvatar } from "@/components/glow/glow-avatar";
import { PremiumPlanBadge } from "@/components/premium/premium-plan-badge";
import { VerifiedAccountMark } from "@/components/trust/verified-account-mark";
import { Button } from "@/components/ui/button";
import { publicMembershipTier } from "@/lib/billing/premium-identity";
import { presenceLabel } from "@/lib/presence/freshness";
import type { SocializePerson } from "@/lib/social/socialize-mobile";
import { cn } from "@/lib/utils";

/**
 * One person in Socialize discovery.
 *
 * Photo-led on purpose: the portrait is the reason to stop, and everything
 * else is a caption on it. The card answers four questions in order — who is
 * this, are they around, how close, what can I do — and deliberately nothing
 * else. There is no age, no interest chips, no verification tick and no mutual
 * count, because none of those exist in the projection; a card that renders
 * empty rows for them is advertising data the product does not have.
 *
 * Memoised: a discovery page re-renders on every filter keystroke, and the
 * card's props are stable per person, so re-rendering a rail of portraits on
 * each character typed is pure waste.
 */

/** Proximity, in words. Never a distance, never a coordinate. */
const PROXIMITY_LABEL: Record<string, string> = {
  close: "Close by",
  near: "Nearby",
  far: "Around you"
};

export type SocializePersonCardProps = {
  person: SocializePerson;
  onWave: (person: SocializePerson) => void;
  /** Present only when the viewer can already message this person. */
  onMessage?: (person: SocializePerson) => void;
  pending?: boolean;
  /**
   * Future slots. Rendered only when a caller passes real content, so the
   * layout is ready for Spark, interests, mutual Muddies and recommendation
   * context without any of them being stubbed in today.
   */
  slots?: {
    beforeActions?: ReactNode;
    afterIdentity?: ReactNode;
  };
};

function PersonCard({ person, onWave, onMessage, pending = false, slots }: SocializePersonCardProps) {
  const name = person.displayName || person.username;
  const profileHref = `/friends/${person.username}` as Route;

  // A hedged presence REPLACES proximity rather than joining it: if we are
  // unsure they are still there, we must not also claim how close they are.
  const hedge = presenceLabel(person.presenceState);
  const isActiveNow = person.presenceState === "fresh";
  const proximity = PROXIMITY_LABEL[person.proximityTier] ?? null;
  const locationLine = hedge ?? proximity;

  const waved = person.waveState === "sent";
  const inbound = person.waveState === "received";
  const connected = person.waveState === "accepted";
  const canMessage = connected && Boolean(onMessage);

  /**
   * One accessible name for the whole card, so a screen reader announces the
   * person once rather than reading a portrait link, a name link and a status
   * pill as three separate items.
   */
  const accessibleName = [
    name,
    isActiveNow ? "active now" : hedge,
    proximity && !hedge ? proximity : null
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <article
      aria-label={accessibleName}
      className={cn(
        // `linkr-card` carries radius, border, shadow, hover and press for all
        // three discovery cards, so People, Plans and Groups cannot drift into
        // three different design languages.
        "linkr-card group relative flex h-full flex-col overflow-hidden"
      )}
    >
      {/* PORTRAIT. The whole image is the profile link, so the largest target
          on the card is also the most likely intent. */}
      <Link
        href={profileHref}
        aria-label={`View ${name}'s profile`}
        className="focus-ring relative block aspect-[4/5] w-full overflow-hidden bg-secondary/40"
      >
        {person.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- signed avatar URL, not a static asset
          <img
            src={person.avatarUrl}
            alt=""
            loading="lazy"
            decoding="async"
            className={cn(
              "h-full w-full object-cover",
              // A quiet settle on load and a barely-there zoom on hover: enough
              // to feel alive, not enough to read as motion.
              "socialize-card-image linkr-card-media"
            )}
          />
        ) : (
          // Canonical fallback rather than empty space — and it still carries
          // proximity and membership, so a person without a photo is not a
          // person without identity.
          <span className="grid h-full w-full place-items-center">
            <GlowAvatar
              name={name}
              src={null}
              size="xl"
              proximityLevel={person.proximityTier}
              membershipTier={publicMembershipTier(person.plan)}
            />
          </span>
        )}

        {/* Presence pill. Shown only when someone is genuinely active — a
            permanent badge on everyone would carry no information. */}
        {isActiveNow ? (
          <span className="pointer-events-none absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full bg-background/85 px-2.5 py-1 text-[11px] font-semibold backdrop-blur-sm">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden="true" />
            Active now
          </span>
        ) : null}

        {/* A gentle floor under the text below, so a bright photo cannot
            wash out the name that sits against it. */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-card/70 to-transparent"
        />
      </Link>

      <div className="flex flex-1 flex-col gap-1.5 p-4 pt-3.5">
        <p className="flex min-w-0 items-center gap-1.5">
          <Link href={profileHref} className="focus-ring truncate text-[0.9375rem] font-semibold leading-snug hover:underline">
            {name}
          </Link>
          {/* Canonical membership badge. Never presented as verification. */}
          <VerifiedAccountMark isVerifiedAccount={person.isVerifiedAccount} compact />
          <PremiumPlanBadge plan={person.plan} compact />
        </p>

        {locationLine ? (
          <p className="truncate text-[0.8125rem] leading-normal text-muted-foreground">{locationLine}</p>
        ) : null}

        {/* Their own words, when they wrote any. Never invented. */}
        {person.note ? (
          <p className="line-clamp-2 pt-0.5 text-xs leading-5 text-muted-foreground">{person.note}</p>
        ) : null}

        {slots?.afterIdentity}

        <div className="mt-auto space-y-2 pt-3">
          {slots?.beforeActions}

          {/* PRIMARY. Exactly one, and it depends on the relationship the
              server already reported — the card never offers an action that
              would be rejected on submit. */}
          {canMessage ? (
            <Button
              type="button"
              className="min-h-[42px] w-full rounded-2xl"
              disabled={pending}
              onClick={() => onMessage?.(person)}
            >
              <MessageCircle className="h-4 w-4" aria-hidden="true" />
              Message
            </Button>
          ) : (
            <Button
              type="button"
              variant={waved ? "outline" : "primary"}
              className="min-h-[42px] w-full rounded-2xl"
              disabled={pending || waved}
              onClick={() => onWave(person)}
            >
              <FeatureIcon feature="wave" size={18} decorative />
              {waved ? "Wave sent" : inbound ? "Accept & connect" : "Wave"}
            </Button>
          )}

          <Link
            href={profileHref}
            className="focus-ring safe-motion flex min-h-[38px] w-full items-center justify-center rounded-2xl border border-border/60 text-[0.8125rem] font-semibold text-muted-foreground transition-colors hover:bg-secondary/40 hover:text-foreground"
          >
            View profile
          </Link>
        </div>
      </div>
    </article>
  );
}

export const SocializePersonCard = memo(PersonCard);

/**
 * Card-shaped skeleton.
 *
 * Matches the real card's proportions exactly, so the list does not reflow
 * when people arrive — a skeleton of the wrong shape is a layout shift with
 * extra steps.
 */
export function SocializePersonCardSkeleton() {
  return (
    <div
      aria-hidden="true"
      className="linkr-card flex h-full flex-col overflow-hidden"
    >
      <div className="aspect-[4/5] w-full animate-pulse bg-secondary/50 motion-reduce:animate-none" />
      <div className="flex flex-1 flex-col gap-2 p-4 pt-3.5">
        <div className="h-4 w-2/3 animate-pulse rounded bg-secondary/50 motion-reduce:animate-none" />
        <div className="h-3 w-1/2 animate-pulse rounded bg-secondary/40 motion-reduce:animate-none" />
        <div className="mt-auto space-y-2 pt-3">
          <div className="h-[42px] w-full animate-pulse rounded-2xl bg-secondary/40 motion-reduce:animate-none" />
        </div>
      </div>
    </div>
  );
}
