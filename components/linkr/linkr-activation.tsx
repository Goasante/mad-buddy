"use client";

import { useState } from "react";
import { ArrowLeft, Check, MapPinOff, ShieldCheck, UserRoundCog } from "lucide-react";

import { LINKR_INTENTS, type LinkrIntent } from "@/lib/linkr/intent";
import {
  LINKR_COPY,
  LINKR_PROFILE_HANDOFF_CTA,
  LINKR_PROFILE_HANDOFF_TITLE,
  LINKR_UNDERAGE_MESSAGE,
  resolveActivationRequirements
} from "@/lib/linkr/rules";
import { LinkrOrb } from "@/components/linkr/linkr-orb";
import { useImmersiveWhile } from "@/components/app-shell/immersive-mode";

/**
 * Screens 1 and 2 of the approved board: Linkr Off, and the activation sheet
 * it opens.
 *
 * ACTIVATION ASKS ONE QUESTION: do you want to be open to meeting new people,
 * and what kind of connection are you looking for?
 *
 * It collects NO identity. Not a photo, not a date of birth, not a form of any
 * kind. Mad Buddy already has a Profile, and Linkr reads it:
 *
 *   PROFILE  profile picture, showcase photos, date of birth, derived age
 *   LINKR    discoverability, intent, preferences, Pass/Connect, Event Mode
 *
 * When something Profile owns is missing, this screen hands the person to
 * Profile with one message and one destination -- it does not grow an
 * uploader or a date picker of its own. Two identity collectors is how the
 * product ends up with two answers about the same person.
 */

export type LinkrActivationProps = {
  onEnable: (intent: LinkrIntent) => Promise<void> | void;
  onHowItWorks: () => void;
  /** Sends the person to the canonical Profile editor to finish identity. */
  onCompleteProfile: (intent: LinkrIntent) => void;
  busy?: boolean;
  error?: string | null;
  /**
   * The SERVER-derived age, or null when Profile holds no date of birth.
   * Never a raw date: this screen only needs to know whether they qualify.
   */
  age?: number | null;
  /** Whether Profile holds a profile picture. Linkr reads it, never sets it. */
  hasProfilePhoto?: boolean;
  /** Intent carried back from a Profile round trip, so nothing is retyped. */
  initialIntent?: LinkrIntent;
};

export function LinkrOffScreen({
  onEnable,
  onHowItWorks,
  onCompleteProfile,
  busy,
  error,
  age = null,
  hasProfilePhoto = false,
  initialIntent = "friends"
}: LinkrActivationProps) {
  const [stage, setStage] = useState<"off" | "consent">("off");
  const [intent, setIntent] = useState<LinkrIntent>(initialIntent);

  const requirements = resolveActivationRequirements({
    age,
    hasPrimaryPhoto: hasProfilePhoto
  });

  /**
   * Activation takes the whole screen.
   *
   * The global bottom navigation under a setup flow made it read as a form
   * laid on top of the app, and invited someone to wander off mid-way.
   * `useImmersiveWhile` clears on unmount, so any exit restores the bar.
   */
  useImmersiveWhile(stage === "consent");

  if (stage === "consent") {
    return (
      <section className="linkr-activate" aria-labelledby="linkr-activate-title">
        <button type="button" className="linkr-back" onClick={() => setStage("off")} aria-label="Back">
          <ArrowLeft aria-hidden />
        </button>

        <LinkrOrb variant="activate" />

        <h1 id="linkr-activate-title" className="linkr-activate__title">
          {LINKR_COPY.activationTitle}
        </h1>

        <ul className="linkr-activate__points">
          {LINKR_COPY.activationPoints.map((point, index) => (
            <li key={point}>
              {index === 0 ? <Check aria-hidden /> : index === 1 ? <MapPinOff aria-hidden /> : <ShieldCheck aria-hidden />}
              <span>{point}</span>
            </li>
          ))}
        </ul>

        <fieldset className="linkr-intent">
          <legend className="linkr-intent__legend">{LINKR_COPY.intentPrompt}</legend>
          <div className="linkr-intent__options" role="radiogroup" aria-label={LINKR_COPY.intentPrompt}>
            {LINKR_INTENTS.map((option) => (
              <button
                key={option.id}
                type="button"
                role="radio"
                aria-checked={intent === option.id}
                className={`linkr-pill ${intent === option.id ? "is-selected" : ""}`}
                onClick={() => setIntent(option.id)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </fieldset>

        {/* --- Profile handoff -----------------------------------------------
            ONE message and ONE destination, however many things are missing.
            A photo and a date of birth both live in Profile, so two prompts
            would send somebody to the same screen twice. */}
        {requirements.profileMessage ? (
          <div className="linkr-handoff">
            <span className="linkr-handoff__icon" aria-hidden>
              <UserRoundCog />
            </span>
            <div className="linkr-handoff__text">
              <strong>{LINKR_PROFILE_HANDOFF_TITLE}</strong>
              <small>{requirements.profileMessage}</small>
            </div>
          </div>
        ) : null}

        {/* Under 18 is an ANSWER, not an outstanding task: there is nothing to
            complete and no editor to offer, so no CTA appears. */}
        {requirements.underage ? (
          <p className="linkr-activate__notice">{LINKR_UNDERAGE_MESSAGE}</p>
        ) : null}

        {error ? (
          <p className="linkr-activate__error" role="alert">
            {error}
          </p>
        ) : null}

        {requirements.profileMessage ? (
          <button type="button" className="linkr-primary" onClick={() => onCompleteProfile(intent)}>
            {LINKR_PROFILE_HANDOFF_CTA}
          </button>
        ) : (
          <button
            type="button"
            className="linkr-primary"
            onClick={() => onEnable(intent)}
            disabled={busy || !requirements.canActivate}
          >
            {busy ? "Turning on…" : LINKR_COPY.turnOn}
          </button>
        )}

        {requirements.underage ? null : (
          <p className="linkr-activate__footnote">{LINKR_COPY.activationFootnote}</p>
        )}
      </section>
    );
  }

  return (
    <section className="linkr-off" aria-labelledby="linkr-off-title">
      <h1 id="linkr-off-title" className="linkr-off__title">
        Meet people who are open to{" "}
        <span className="linkr-off__accent">connecting.</span>
      </h1>
      <p className="linkr-off__privacy">{LINKR_COPY.offPrivacy}</p>

      <LinkrOrb variant="off" />

      <button type="button" className="linkr-primary" onClick={() => setStage("consent")}>
        {LINKR_COPY.turnOn}
      </button>
      <button type="button" className="linkr-link" onClick={onHowItWorks}>
        {LINKR_COPY.howItWorks} <span aria-hidden>?</span>
      </button>
    </section>
  );
}
