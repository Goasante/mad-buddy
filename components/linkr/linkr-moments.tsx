"use client";

import { ArrowLeft, Eye, Hand, MapPinOff, ShieldCheck, Users } from "lucide-react";

import { HOW_LINKR_WORKS, LINKR_COPY } from "@/lib/linkr/rules";
import { LinkrOrb } from "@/components/linkr/linkr-orb";

/**
 * The screens that are moments rather than surfaces: the match, the empty
 * deck, the education screen, and the Event Mode intro.
 *
 * Grouped in one file because they share a shape -- a full-bleed panel with a
 * single decision at the bottom -- and because keeping them together makes it
 * obvious that they must not accumulate controls. Each of these screens has
 * exactly one thing to say.
 */

// ---------------------------------------------------------------------------
// Screen 6: mutual connection
// ---------------------------------------------------------------------------

export type MatchScreenProps = {
  me: { displayName: string; photo: string | null };
  them: { displayName: string; photo: string | null };
  onSayHi: () => void;
  onKeepDiscovering: () => void;
  /**
   * Whether the pair has already spoken. Offering "Say hi" on a conversation
   * three messages deep invites someone to start what they already started,
   * so the CTA follows the conversation rather than the connection.
   */
  hasConversation?: boolean;
};

export function LinkrMatchScreen({
  me,
  them,
  onSayHi,
  onKeepDiscovering,
  hasConversation = false
}: MatchScreenProps) {
  return (
    <section className="linkr-match" role="dialog" aria-modal="true" aria-labelledby="linkr-match-title">
      <div className="linkr-match__faces">
        <MatchFace person={me} />
        <span className="linkr-match__wave" aria-hidden>
          <Hand />
        </span>
        <MatchFace person={them} />
      </div>

      <h1 id="linkr-match-title" className="linkr-match__title">
        {LINKR_COPY.matchTitle} <span aria-hidden>🎉</span>
      </h1>
      <p className="linkr-match__body">{LINKR_COPY.matchBody(them.displayName)}</p>

      <button type="button" className="linkr-primary" onClick={onSayHi}>
        {hasConversation ? LINKR_COPY.continueChat : LINKR_COPY.sayHi}
      </button>
      <button type="button" className="linkr-secondary" onClick={onKeepDiscovering}>
        {LINKR_COPY.keepDiscovering}
      </button>
    </section>
  );
}

function MatchFace({ person }: { person: { displayName: string; photo: string | null } }) {
  return person.photo ? (
    // eslint-disable-next-line @next/next/no-img-element -- signed, short-lived media URL
    <img src={person.photo} alt={person.displayName} className="linkr-match__face" />
  ) : (
    <span className="linkr-match__face linkr-match__face--fallback" aria-label={person.displayName}>
      {person.displayName.charAt(0).toUpperCase()}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Screen 13: nobody around
// ---------------------------------------------------------------------------

export type EmptyStateProps = {
  onWiden: () => void;
  /** Absent once the viewer is already at the widest band. */
  canWiden: boolean;
};

export function LinkrEmptyState({ onWiden, canWiden }: EmptyStateProps) {
  return (
    <section className="linkr-empty" aria-labelledby="linkr-empty-title">
      <LinkrOrb variant="empty" />
      <h1 id="linkr-empty-title" className="linkr-empty__title">
        {LINKR_COPY.emptyTitle} <span aria-hidden>👀</span>
      </h1>
      {/* The sentence follows the button. When the viewer is already at the
          widest setting there is nothing to widen, so promising it would send
          them looking for a control that is not there. */}
      <p className="linkr-empty__body">
        {canWiden ? LINKR_COPY.emptyBody : LINKR_COPY.emptyBodyWidest}
      </p>
      {/* Deliberately nothing else. The old Linkr filled this space with Groups
          and Plans; an empty discovery deck is not an opportunity to advertise
          a different product. */}
      {canWiden ? (
        <button type="button" className="linkr-primary" onClick={onWiden}>
          {LINKR_COPY.widenSearch}
        </button>
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Screen 14: how Linkr works
// ---------------------------------------------------------------------------

const HOW_ICONS = [Users, MapPinOff, ShieldCheck, Hand];

export function HowLinkrWorks({ onClose }: { onClose: () => void }) {
  return (
    <section className="linkr-sheet" aria-labelledby="linkr-how-title">
      <header className="linkr-sheet__head">
        <button type="button" className="linkr-back" onClick={onClose} aria-label="Back">
          <ArrowLeft aria-hidden />
        </button>
        <h1 id="linkr-how-title">How Linkr works</h1>
        <span />
      </header>

      <ul className="linkr-how">
        {HOW_LINKR_WORKS.map((item, index) => {
          const Icon = HOW_ICONS[index] ?? Eye;
          return (
            <li key={item.title} className="linkr-how__item">
              <span className="linkr-how__icon" aria-hidden>
                <Icon />
              </span>
              <span>
                <strong>{item.title}</strong>
                <small>{item.body}</small>
              </span>
            </li>
          );
        })}
      </ul>

      <button type="button" className="linkr-primary" onClick={onClose}>
        Got it
      </button>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Screen 7: Event Mode intro
// ---------------------------------------------------------------------------

export type EventIntroProps = {
  eventName: string;
  whenLabel: string | null;
  venueLabel: string | null;
  /**
   * The crowd line, already resolved by the EVENTS small-pool rule. A raw
   * count never reaches this component, so there is nothing here that could
   * accidentally render "3 people" at a tiny event.
   */
  poolLabel: string | null;
  onBrowse: () => void;
  onBack: () => void;
};

export function EventModeIntro({
  eventName,
  whenLabel,
  venueLabel,
  poolLabel,
  onBrowse,
  onBack
}: EventIntroProps) {
  return (
    <section className="linkr-event-intro" aria-labelledby="linkr-event-title">
      <button type="button" className="linkr-back" onClick={onBack} aria-label="Back">
        <ArrowLeft aria-hidden />
      </button>

      <div className="linkr-event-intro__banner">
        <span className="linkr-event-intro__live">
          <span className="linkr-event-intro__dot" aria-hidden /> LIVE
        </span>
        <h1 id="linkr-event-title" className="linkr-event-intro__name">
          {eventName}
        </h1>
        {whenLabel ? <p className="linkr-event-intro__when">{whenLabel}</p> : null}
        {venueLabel ? <p className="linkr-event-intro__venue">{venueLabel}</p> : null}
      </div>

      {/* The Event is the context, not general geography: this screen never
          says "discover nearby". */}
      <h2 className="linkr-event-intro__title">{LINKR_COPY.eventIntroTitle}</h2>
      <p className="linkr-event-intro__body">{LINKR_COPY.eventIntroBody}</p>
      {poolLabel ? <p className="linkr-event-intro__pool">{poolLabel}</p> : null}

      <button type="button" className="linkr-primary" onClick={onBrowse}>
        {LINKR_COPY.eventBrowse}
      </button>
    </section>
  );
}
