"use client";

import { ArrowLeft, MessageCircle } from "lucide-react";

import { LINKR_COPY } from "@/lib/linkr/rules";
import type { ClickedPerson, PendingClick } from "@/lib/linkr/collections-service";

/**
 * Screen 15: the persistent Linkr collections.
 *
 * Mutual people leave the Discover deck -- swiping on somebody you already
 * matched with is nonsense -- but leaving the deck used to mean leaving Linkr
 * entirely. This is where they go instead.
 *
 * TWO LISTS, AND THE DIFFERENCE BETWEEN THEM IS THE PRIVACY RULE:
 *
 *   Clicked     both of you chose each other. There is someone to talk to.
 *   Your clicks you chose them. What they did is not shown, not fetched, and
 *               not knowable from anything on this screen.
 *
 * Your clicks therefore says nothing at all about the other person's state --
 * no "waiting", no "pending", no "they haven't chosen you". It is a memory
 * aid for your OWN decisions, and reads as one.
 */

export function LinkrCollections({
  clicked,
  pending,
  onOpenPerson,
  onBack
}: {
  clicked: readonly ClickedPerson[];
  pending: readonly PendingClick[];
  /** Opens the mutual state, or the conversation if one is under way. */
  onOpenPerson: (person: ClickedPerson) => void;
  onBack: () => void;
}) {
  return (
    <section className="linkr-sheet" aria-labelledby="linkr-clicked-title">
      <header className="linkr-sheet__head">
        <button type="button" className="linkr-back" onClick={onBack} aria-label="Back">
          <ArrowLeft aria-hidden />
        </button>
        <h1 id="linkr-clicked-title">{LINKR_COPY.clickedTitle}</h1>
        <span />
      </header>

      <div className="linkr-sheet__body">
        {clicked.length === 0 ? (
          <p className="linkr-collection__empty">{LINKR_COPY.clickedEmpty}</p>
        ) : (
          <ul className="linkr-collection">
            {clicked.map((person) => (
              <li key={person.connectionId}>
                <button
                  type="button"
                  className="linkr-collection__row"
                  onClick={() => onOpenPerson(person)}
                >
                  <Face photo={person.photo} name={person.displayName} />
                  <span className="linkr-collection__text">
                    <strong>{person.displayName}</strong>
                    {/* The CTA follows the conversation's real state: once
                        somebody has actually spoken, offering "Say hi" would
                        be offering to start something already started. */}
                    <small>
                      {person.hasConversation ? LINKR_COPY.continueChat : LINKR_COPY.sayHi}
                    </small>
                  </span>
                  <MessageCircle className="linkr-collection__icon" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}

        {/* YOUR CLICKS. Deliberately below Clicked: the people who chose you
            back are the ones worth seeing first. */}
        <h2 className="linkr-settings__group">{LINKR_COPY.yourClicksTitle}</h2>
        <p className="linkr-collection__hint">{LINKR_COPY.yourClicksHint}</p>

        {pending.length === 0 ? (
          <p className="linkr-collection__empty">{LINKR_COPY.yourClicksEmpty}</p>
        ) : (
          <ul className="linkr-collection">
            {pending.map((person) => (
              <li key={person.userId}>
                {/* NOT a button. There is nothing to open: opening a person who
                    has not chosen you back would have to render something
                    about their state, and there is nothing about their state
                    this screen is allowed to know. */}
                <div className="linkr-collection__row linkr-collection__row--static">
                  <Face photo={person.photo} name={person.displayName} />
                  <span className="linkr-collection__text">
                    <strong>{person.displayName}</strong>
                    {/* Describes the VIEWER's own action, never the other
                        person's. "You clicked" is a fact about you. */}
                    <small>You clicked</small>
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function Face({ photo, name }: { photo: string | null; name: string }) {
  return photo ? (
    // eslint-disable-next-line @next/next/no-img-element -- signed, short-lived media URL
    <img src={photo} alt="" className="linkr-collection__face" />
  ) : (
    <span className="linkr-collection__face linkr-collection__face--fallback" aria-hidden>
      {name.charAt(0).toUpperCase()}
    </span>
  );
}
