"use client";

import { useEffect, useState } from "react";

/**
 * THE LINKR ARTWORK SLOT.
 *
 * The approved board shows three pieces of bespoke Linkr artwork:
 *
 *   variant="off"       the orbital "people around you" mark (screen 1)
 *   variant="activate"  the two-figure connection glyph (screen 2)
 *   variant="empty"     the searching-magnifier mark (screen 13)
 *
 * NONE OF THESE ARE FINAL. This component is a SLOT with fixed dimensions and
 * a deliberately plain development placeholder, not a CSS re-creation of the
 * board -- reproducing bespoke artwork with gradients and pseudo-elements
 * produces something that looks approximately right, gets shipped, and then
 * never gets replaced because it is "already done".
 *
 *   FINAL LINKR ACTIVATION ASSET REQUIRED  -> /public/linkr/orb-off.png
 *   FINAL LINKR CONNECTION ASSET REQUIRED  -> /public/linkr/orb-activate.png
 *   FINAL LINKR EMPTY-STATE ASSET REQUIRED -> /public/linkr/orb-empty.png
 *
 * Drop a file at any of those paths and it is used automatically; the
 * placeholder disappears with no code change. The slot reserves the same box
 * either way, so the final art cannot shift the layout it lands in.
 *
 * WHERE THIS MAY APPEAR (brief §72): Linkr Off, activation, loading, and the
 * empty state. It is deliberately NOT rendered once discovery is live -- the
 * old permanent "Around You" dashboard is exactly what Linkr 2.0 removes.
 */

export type LinkrOrbVariant = "off" | "activate" | "empty";

const ASSET_PATHS: Record<LinkrOrbVariant, string> = {
  off: "/linkr/orb-off.png",
  activate: "/linkr/orb-activate.png",
  empty: "/linkr/orb-empty.png"
};

const ALT_TEXT: Record<LinkrOrbVariant, string> = {
  off: "People around you, shown as an orbit rather than a map",
  activate: "Two people connecting",
  empty: "Searching for people nearby"
};

export function LinkrOrb({ variant }: { variant: LinkrOrbVariant }) {
  const [assetAvailable, setAssetAvailable] = useState<boolean | null>(null);
  const src = ASSET_PATHS[variant];

  // Probed rather than assumed, so the same build works before and after the
  // artwork arrives. Runs once per variant and is cheap: a cached HEAD.
  useEffect(() => {
    let cancelled = false;
    const image = new Image();
    image.onload = () => !cancelled && setAssetAvailable(true);
    image.onerror = () => !cancelled && setAssetAvailable(false);
    image.src = src;
    return () => {
      cancelled = true;
    };
  }, [src]);

  return (
    /**
     * The box is reserved by CSS at a fixed aspect ratio in BOTH states, so
     * the real artwork replacing the placeholder cannot shift the form below
     * it. `assetAvailable === null` is the un-probed moment: it renders the
     * placeholder, which is why the swap is a fade rather than a jump.
     */
    <div className={`linkr-orb linkr-orb--${variant}`} data-state={assetAvailable ? "asset" : "placeholder"}>
      {assetAvailable ? (
        // eslint-disable-next-line @next/next/no-img-element -- probed static asset
        <img src={src} alt={ALT_TEXT[variant]} className="linkr-orb__art" />
      ) : (
        /**
         * A quiet branded bloom, holding the space until the real asset lands.
         *
         * Carries NO developer text -- no "LINKR ARTWORK", no "PLACEHOLDER",
         * no "TODO". A label like that is fine in a mockup and unacceptable in
         * a screen a person is looking at, and it also made the placeholder
         * read as the finished design. It is deliberately soft and unfinished
         * so nobody mistakes it for the approved artwork.
         */
        <div className="linkr-orb__placeholder" role="presentation" />
      )}
    </div>
  );
}
