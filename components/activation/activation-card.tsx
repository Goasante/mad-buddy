"use client";

import Link from "next/link";
import type { Route } from "next";
/* Glow wears one glyph across the product now: the Glow settings page, the
   settings row, the public pages and these activation prompts all use
   RadioTower -- proximity presence being broadcast, rather than "magic". */
import { CalendarCheck2, Hand, MapPin, MessageCircle, RadioTower, UserPlus } from "lucide-react";
import type { ActivationAction, ActivationState } from "@/lib/activation/state";
import { primaryActionFor } from "@/lib/activation/state";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { UserAvatar } from "@/components/ui/user-avatar";
import { brandSymbol } from "@/lib/brand/assets";
import { cn } from "@/lib/utils";

/**
 * What Home leads with while somebody is still arriving.
 *
 * ONE OBJECTIVE PER STATE. Each variation below says one thing and offers one
 * action, because a person who has just joined cannot triage a wall of
 * options -- and the state model has already decided which single thing is
 * most useful right now.
 *
 * THE COPY IS THE FEATURE. These strings are the product talking to somebody
 * on their first day, so they name what happens next in plain words rather
 * than describing the app to itself. "Nobody's out right now" is a fact about
 * their evening; "No results" is a database report.
 *
 * BRAND. Warm orange primary on the app's existing surfaces, the established
 * 0.5rem radius, and the Glow metaphor for proximity. No new palette, no map
 * pins, no radar -- Glow is how Mad Buddy shows nearness.
 */

type Copy = {
  headline: string;
  body: string;
  actionLabel: string;
  href: Route;
  icon: typeof UserPlus;
  /** A second, quieter route out. Never a competing primary. */
  secondary?: { label: string; href: Route };
  /**
   * One compact reassurance, shown under the actions.
   *
   * Only where the state actually raises the question -- a person being asked
   * to connect or to share location. Repeating it everywhere would turn Home
   * into a privacy notice and make the promise read as nervousness.
   */
  privacyNote?: string;
};

const COPY: Record<Exclude<ActivationState, "activated">, Copy> = {
  no_muddies: {
    headline: "Start with one person",
    /* Human, and short.
     *
     * "Mad Buddy runs on people you already know" describes the product's
     * mechanics; a person reading this wants to know what happens after they
     * tap. So it names the payoff in their words -- you see them, then you do
     * something about it -- and stops. Two sentences is the whole budget: the
     * card is an invitation, not an explanation page. */
    // One sentence. Names the action, the payoff, and what follows it.
    body: "Add your first Muddy to see their Glow when they're close by — then say hi or make a plan.",
    actionLabel: "Find your first Muddy",
    href: "/friends" as Route,
    icon: UserPlus,
    secondary: { label: "Share your invite link", href: "/invite" as Route },
    // §4: one line, in the hero, not a privacy card. Existing product wording.
    privacyNote: "Only approved Muddies. Never your exact location."
  },
  request_pending: {
    headline: "Waiting on your first Muddy",
    /* Acknowledges what they did. No pressure, no nudge to ask again -- the
       other person answering is not something they can hurry, and implying
       otherwise would make waiting feel like failure. */
    body: "Your request is on its way. You can add someone else in the meantime — Muddies aren't one at a time.",
    actionLabel: "Find another Muddy",
    href: "/friends" as Route,
    icon: UserPlus,
    secondary: { label: "Share your invite link", href: "/invite" as Route }
  },
  visibility_off: {
    /* Location is sorted; this is the remaining choice.
     *
     * "Glow is ready" says the setup worked -- which it did -- so the last step
     * reads as a decision rather than another obstacle. New accounts start in
     * ghost, so this is the common path, and it stays an offer: declining
     * leaves Messages, Muddies and Plans exactly as they were. */
    headline: "Glow is ready",
    body: "Choose when your Muddies can see your Glow. You can turn it off again whenever you like.",
    actionLabel: "Turn on visibility",
    href: "/settings" as Route,
    icon: RadioTower,
    privacyNote: "Only approved Muddies. Never your exact location."
  },
  muddies_no_location: {
    /* ONE GLOW LANGUAGE, NOT TWO.
     *
     * This branch predates the first-Muddy card and never inherited its
     * wording, so whichever card somebody happened to meet first taught them
     * a different vocabulary for the same capability: "Turn on location" with
     * a map pin here, "Turn on Glow" there. It names the Mad Buddy capability
     * now, and the OS mechanism stays behind the tap.
     *
     * "They see your area" is gone with it -- it invited "how big an area?",
     * and the honest promise is simply that the exact place is never shown. */
    headline: "Turn on Glow",
    body: "Mad Buddy uses your location privately to know when approved Muddies are close by.",
    actionLabel: "Turn on Glow",
    href: "/settings" as Route,
    icon: RadioTower,
    privacyNote: "Only approved Muddies. Never your exact location. You stay in control."
  },
  location_stale: {
    /* A RECOVERY, NOT AN ERROR -- and not a repeat of the permission talk.
     *
     * Location already works; the fix is just old. So this says what Glow
     * needs and offers the one action that supplies it, without replaying the
     * first-time privacy education at somebody who finished it this morning.
     *
     * The copy carries no timestamp, no age, no threshold. "How old is too
     * old" is Mad Buddy's problem, not something to make a person reason about
     * -- and a number here would invite them to work out how precisely the app
     * is tracking them, which is the opposite of the promise. */
    headline: "Refresh your Glow",
    body: "Glow needs an updated location before it can show who's around.",
    actionLabel: "Refresh Glow",
    href: "/settings" as Route,
    icon: MapPin
  },
  no_one_nearby: {
    /* A SUCCESS state, and it has to say so.
     *
     * Setup is finished and working; nobody being out is an ordinary evening,
     * not an error. "Glow is on" confirms the thing they just did, and the
     * second sentence explains what will happen rather than implying something
     * went wrong. No "nothing here", no "try again", no re-prompt. */
    headline: "Glow is on",
    body: "No Muddies are close by right now. Their Glow will appear here when someone's around.",
    actionLabel: "Make a plan",
    href: "/plans?create=1" as Route,
    icon: CalendarCheck2,
    secondary: { label: "Message a Muddy", href: "/messages" as Route }
  },
  muddy_nearby: {
    // The payoff. One tap, no commitment -- asking for a Plan here would skip
    // the part where they say hello.
    headline: "Someone's nearby",
    body: "A Muddy is around right now. A wave is the easiest way to start.",
    actionLabel: "Send a wave",
    href: "/discover" as Route,
    icon: Hand,
    secondary: { label: "Make a plan instead", href: "/plans?create=1" as Route }
  },
  upcoming_plan: {
    headline: "You've got something on",
    body: "Your next plan is coming up. Everyone in it has a chat, so you can sort the details there.",
    actionLabel: "Open your plan",
    href: "/plans" as Route,
    icon: CalendarCheck2
  }
};

const ACTION_ICON: Record<ActivationAction, typeof UserPlus> = {
  find_muddies: UserPlus,
  enable_location: MapPin,
  refresh_location: MapPin,
  enable_visibility: RadioTower,
  say_hi: MessageCircle,
  wave: Hand,
  message: MessageCircle,
  make_plan: CalendarCheck2,
  view_plan: CalendarCheck2
};

/**
 * Glow, introduced without a tutorial and without inventing anybody.
 *
 * WHAT THIS DELIBERATELY IS NOT. No fabricated nearby people, no sample
 * profiles, no map pin, no radar sweep, no distance. Showing invented Muddies
 * to somebody with none would be the app illustrating a social life they do
 * not have yet, and a fake avatar is a promise it cannot keep.
 *
 * What it is: the real brand symbol with the app's own glow token radiating
 * from it, so the first time a Muddy actually appears the visual language is
 * already familiar. Concentric rings read as "presence, nearby" without
 * claiming a location.
 *
 * Motion is one slow opacity breath, disabled under prefers-reduced-motion.
 * Opacity only, never transform: the brand symbol sits on top of it and must
 * not shift or blur.
 */
function GlowIntroMark() {
  // 60px. Small enough to stop dominating the card's height, large enough that
  // three graded rings stay separable -- below about 56px the falloff
  // collapses into one thick edge and the proximity idea is lost.
  return (
    <span aria-hidden="true" className="relative grid h-[3.75rem] w-[3.75rem] place-items-center">
      {/* THREE rings, brightening inward.
          The falloff is the message: presence concentrates near a person and
          fades with distance, which is exactly what a Muddy's glow does on
          Linkr. One ring read as "logo in a circle"; graded rings read as
          proximity. Opacity carries it, so the meaning survives greyscale and
          does not depend on colour alone. */}
      <span
        className="absolute inset-0 animate-[activation-glow_4s_ease-in-out_infinite] rounded-full motion-reduce:animate-none"
        style={{ background: "var(--glow-gradient)" }}
      />
      {/* Insets scaled with the mark, so the three rings keep visible gaps
          between them rather than crowding into one band at the smaller size. */}
      <span className="absolute inset-0 rounded-full border border-primary/15" />
      <span className="absolute inset-[0.4rem] rounded-full border border-primary/30" />
      <span className="absolute inset-[0.8rem] rounded-full border border-primary/50" />
      {/* The symbol sits on the app surface so the artwork stays legible
          against the glow behind it. */}
      <span className="relative grid h-8 w-8 place-items-center rounded-full bg-card">
        <Image
          src={brandSymbol.light.src}
          alt=""
          width={brandSymbol.light.width}
          height={brandSymbol.light.height}
          // The approved artwork. Never tinted, recoloured or filtered.
          className="h-5 w-5 dark:hidden"
        />
        <Image
          src={brandSymbol.dark.src}
          alt=""
          width={brandSymbol.dark.width}
          height={brandSymbol.dark.height}
          className="hidden h-5 w-5 dark:block"
        />
      </span>
    </span>
  );
}

export function ActivationCard({
  state,
  className,
  onPrimaryAction,
  pending = false,
  pendingLabel,
  relationship = null,
  primaryLabel,
  secondaryLabel,
  onSecondaryAction,
  primaryActionId
}: {
  state: ActivationState;
  className?: string;
  /**
   * Run the step here instead of navigating.
   *
   * Supplied by Home for the states it can complete in place — the location
   * prompt and the visibility mutation. Absent means the primary action stays
   * an ordinary link, which is right for states whose next step really is
   * another page.
   */
  onPrimaryAction?: () => void;
  pending?: boolean;
  pendingLabel?: string;
  /**
   * The specific Muddy this card is about, when there is one.
   *
   * Identity only — no proximity, by type as well as by intent.
   */
  relationship?: { id: string; displayName: string; avatarUrl: string | null } | null;
  /**
   * Labels chosen by the contextual decision engine, replacing the generic
   * copy. Absent means the state's default wording stands.
   */
  primaryLabel?: string;
  secondaryLabel?: string;
  onSecondaryAction?: () => void;
  /**
   * Stable identity for the primary action.
   *
   * Rendered as a data attribute so the planned Contextual Guidance System can
   * later spotlight "Say hi" without this component knowing guidance exists —
   * no tooltip, no tour step, just something durable to point at.
   */
  primaryActionId?: string;
}) {
  // Fully activated: Home is Home, and this says nothing at all rather than
  // inventing a task to look helpful.
  if (state === "activated") return null;

  /* THE REAL PAYOFF OUTRANKS A CARD DESCRIBING IT.
   *
   * When a Muddy is genuinely nearby, NearbyHero renders them a few lines
   * below with their avatar, their Glow and their actual proximity band. A
   * card above it announcing "someone's nearby" would say the same thing
   * worse -- second-hand, without the person -- and push the thing it is
   * describing further down the screen. So activation steps aside and lets
   * the moment speak for itself. */
  if (state === "muddy_nearby") return null;

  const copy = COPY[state];
  /* The engine's wording wins where it has an opinion, and the state's own
     copy stands everywhere else. */
  const primaryText = primaryLabel ?? copy.actionLabel;
  const Icon = ACTION_ICON[primaryActionFor(state)] ?? copy.icon;

  return (
    <section
      aria-labelledby="activation-headline"
      className={cn(
        // The app's own surface and radius, not a special activation skin: this
        // is Home talking, not a tutorial layer bolted on top.
        /* Compact, not miniature.
           Horizontal padding is unchanged -- narrowing it would crowd the text
           against the edge. Only the vertical is compressed, which is where
           the wasted height actually was. */
        "relative overflow-hidden rounded-[1.25rem] border border-border/70 bg-card/60 px-5 py-4 sm:px-6 sm:py-5",
        className
      )}
    >
      {/* Glow, at the lowest possible volume. The metaphor is present so
          proximity feels like one idea across the product, but it sits behind
          the words rather than competing with them. */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full opacity-60"
        style={{ background: "var(--glow-gradient)" }}
      />

      {/* The Glow mark belongs to the states that are ABOUT Glow.
          "Glow is on" carried a calendar icon -- borrowed from its Make-a-plan
          action -- on the one card whose entire subject is that Glow works.
          The mark says it in the product's own language, and no map or radar
          metaphor is introduced to do it. */}
      {state === "no_muddies" || state === "no_one_nearby" ? <GlowIntroMark /> : (
        <span className="relative grid h-11 w-11 place-items-center rounded-full bg-primary/10 text-primary">
          <Icon className="h-5 w-5" aria-hidden="true" />
        </span>
      )}

      {/* Tightened rhythm: the mark and the headline belong to each other, so
          the gap between them is smaller than the gap between the headline and
          the body. Spacing steps come from the existing scale -- no negative
          margins, no per-device values. */}
      {/* Compression is all in the GAPS, never the type. Font sizes stay put
          so the card reads as compact rather than shrunken, and nothing gets
          harder to read. */}
      <h2 id="activation-headline" className="relative mt-2.5 text-balance text-xl font-semibold tracking-tight">
        {copy.headline}
      </h2>
      <p className="relative mt-1 max-w-prose text-sm leading-relaxed text-muted-foreground">
        {copy.body}
      </p>

      {/* THE PERSON, NOT AN ERRAND.
          Home knew exactly which Muddy somebody had and still said "Message a
          Muddy". Naming them costs nothing and is the difference between a
          to-do list and something social.

          NOT A NEARBY ROW. No proximity label, no Glow ring, no band -- they
          are here because they are the relevant relationship, and borrowing
          the nearby treatment would imply a closeness this data never claims.
          NearbyHero owns that moment, and it is not on screen when this is. */}
      {relationship ? (
        <div className="relative mt-3 flex items-center gap-3">
          <UserAvatar src={relationship.avatarUrl} name={relationship.displayName} size="sm" />
          <span className="min-w-0 truncate text-sm font-medium">{relationship.displayName}</span>
        </div>
      ) : null}

      {/* One primary. A second option is a quiet link, never a second button
          of equal weight -- two equal buttons is the app failing to decide. */}
      {/* gap-x-4 / gap-y-2: side by side when the width allows, and only a
          small step down when the link wraps -- the previous uniform gap-3
          spent a full row's height whenever it wrapped. The Button keeps
          size="lg", so the primary touch target is unchanged. */}
      <div className="relative mt-3.5 flex flex-wrap items-center gap-x-4 gap-y-2">
        {/* ACTS IN PLACE WHERE IT CAN, LINKS WHERE IT CANNOT.
            Activation used to send every state to /settings, so somebody who
            tapped "Turn on Glow" landed in a privacy screen and had to find
            "Location for glow", then work out that turning Ghost Mode OFF is
            what turns Glow ON. When Home can run the step itself -- the
            permission prompt, the canonical visibility mutation -- it does,
            and the person never leaves the screen that asked. The Link
            remains for states whose action really is another page. */}
        {onPrimaryAction ? (
          <Button
            size="lg"
            /* min(11rem, 100%), not a bare rem (MB-GOD-047): 11rem is 352px at
               200% text, which pushed this CTA past the edge of a 360px screen.
               The min-width exists for visual balance among sibling cards and
               has no business outgrowing the viewport. */
            className="min-w-[min(11rem,100%)]"
            onClick={onPrimaryAction}
            disabled={pending}
            data-activation-action={primaryActionId}
          >
            {pending ? pendingLabel ?? primaryText : primaryText}
          </Button>
        ) : (
          <Button asChild size="lg" className="min-w-[min(11rem,100%)]">
            <Link href={copy.href}>{primaryText}</Link>
          </Button>
        )}
        {/* Same quiet weight as the link it replaces -- a second button of
            equal emphasis is the app failing to decide. */}
        {onSecondaryAction && secondaryLabel ? (
          <button
            type="button"
            onClick={onSecondaryAction}
            disabled={pending}
            className="focus-ring inline-flex min-h-11 items-center rounded-lg px-3 py-1.5 text-sm font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline disabled:opacity-60"
          >
            {secondaryLabel}
          </button>
        ) : copy.secondary ? (
          <Link
            href={copy.secondary.href}
            // py-1.5 keeps a comfortable tap area on a text link without
            // adding measurable height to the row.
            className="focus-ring inline-flex min-h-11 items-center rounded-lg px-3 py-1.5 text-sm font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            {copy.secondary.label}
          </Link>
        ) : null}
      </div>

      {/* One line, small, under the action it reassures about. Not a card, not
          a section, not an icon trio -- the promise is short enough to simply
          say. */}
      {copy.privacyNote ? (
        <p className="relative mt-2.5 text-xs leading-snug text-muted-foreground/80">
          {copy.privacyNote}
        </p>
      ) : null}
    </section>
  );
}
