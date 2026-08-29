"use client";

import { ArrowLeft } from "lucide-react";

import { CandidateCard } from "@/components/linkr/candidate-card";
import { previewCandidateFrom, previewReadiness } from "@/lib/linkr/preview";
import type { LinkrOwnProfile } from "@/lib/linkr/profile-service";

/**
 * "Preview my Linkr card" — your own card, rendered by the real card.
 *
 * WHAT THIS REPLACES. The control used to call
 * `setNotice("Your card is what other people see on the left.")` from inside
 * the profile editor. That view returns early, before the notice element is
 * rendered, so the tap displayed nothing at all -- and the copy described a
 * left-hand pane that does not exist on a phone. It was a dead control.
 *
 * THE SAME RENDERER, DELIBERATELY. This mounts CandidateCard, the component
 * the discovery deck uses, rather than a preview-only card. A preview whose
 * layout can drift from the real thing is worse than no preview: it would
 * reassure somebody about a card nobody else sees.
 *
 * THE DECISION CONTROLS ARE INERT HERE. CandidateCard carries Pass and
 * Connect, and there is nobody to pass on or connect with, so both are wired
 * to no-ops and the card is marked busy -- which is the component's own way of
 * disabling them. Nothing about the card's layout changes as a result, so what
 * is previewed remains what is shipped.
 */
export function LinkrPreview({
  profile,
  onBack,
  onEditProfile
}: {
  profile: LinkrOwnProfile;
  onBack: () => void;
  /** Canonical Profile editing, for anything this surface does not own. */
  onEditProfile: () => void;
}) {
  const candidate = previewCandidateFrom(profile);
  const readiness = previewReadiness(profile);

  return (
    <section className="linkr-sheet" aria-labelledby="linkr-preview-title">
      <header className="linkr-sheet__head">
        <button type="button" className="linkr-back" onClick={onBack} aria-label="Back">
          <ArrowLeft aria-hidden />
        </button>
        <h1 id="linkr-preview-title">Your Linkr card</h1>
        <span />
      </header>

      <p className="linkr-preview__headline">{readiness.headline}</p>

      {/* NOT DISCOVERABLE YET, SAID PLAINLY.
          The preview opens either way -- somebody with an incomplete profile
          is exactly who most needs to see this -- but showing the card without
          saying it is unpublished would let them believe people are seeing it.
          The list is the canonical missingRequirements the profile service
          already computes; this surface does not invent its own rules. */}
      {!readiness.discoverable && readiness.missing.length > 0 ? (
        <ul className="linkr-preview__missing">
          {readiness.missing.map((requirement) => (
            <li key={requirement}>{requirement}</li>
          ))}
        </ul>
      ) : null}

      <div className="linkr-preview__stage" data-linkr-preview-card>
        <CandidateCard
          candidate={candidate}
          onPass={() => {}}
          onConnect={() => {}}
          /* `busy` is the card's own disabled state, so the decision controls
             cannot fire against a card that represents nobody. */
          busy
        />
      </div>

      <button type="button" className="linkr-secondary" onClick={onEditProfile}>
        Edit photos and details
      </button>
    </section>
  );
}
