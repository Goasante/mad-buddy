"use client";

import { Hand, X } from "lucide-react";

import { LINKR_COPY } from "@/lib/linkr/rules";

/**
 * The mutual signal for the person who clicked FIRST.
 *
 * WHY THIS IS NOT THE MATCH SCREEN. The second connector taps Connect and the
 * full-screen mutual moment is the direct answer to their own action -- they
 * asked for it a fraction of a second earlier. The first connector chose days
 * ago and is, right now, mid-decision about somebody else. Throwing a
 * full-screen modal over a card they are actively swiping would steal the
 * gesture and could record a decision they never meant to make.
 *
 * So the same news arrives as a banner: it does not cover the card, does not
 * capture the pointer, and does not move anything under the finger. Tapping it
 * is an explicit second act.
 */
export function LinkrMutualBanner({
  name,
  onOpen,
  onDismiss
}: {
  name: string;
  onOpen: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className="linkr-mutual-banner" role="status" aria-live="polite">
      <span className="linkr-mutual-banner__wave" aria-hidden>
        <Hand />
      </span>

      <button type="button" className="linkr-mutual-banner__body" onClick={onOpen}>
        <strong>{LINKR_COPY.mutualBanner(name)}</strong>
        <small>{LINKR_COPY.mutualBannerAction}</small>
      </button>

      <button
        type="button"
        className="linkr-mutual-banner__close"
        onClick={onDismiss}
        aria-label="Dismiss"
      >
        <X aria-hidden />
      </button>
    </div>
  );
}
