"use client";

import { useEffect, useRef, useState } from "react";

import { useWebAds } from "@/components/ads/web-ads-provider";

/** AdSense mutates this queue when its asynchronous script becomes available. */
declare global {
  interface Window {
    adsbygoogle?: Array<Record<string, unknown>>;
  }
}

type AdStatus = "unknown" | "filled" | "unfilled";

/**
 * One passive responsive display ad.
 *
 * It renders no placeholder, no house-ad imitation, and no reserved blank box
 * when advertising is disabled, the account owns Access, configuration is
 * absent, the provider has not loaded, or Google reports the unit unfilled.
 */
export function InlineAdSlot({
  slot,
  placement
}: {
  slot?: string | null;
  placement: string;
}) {
  const { canRequest, config, scriptReady } = useWebAds();
  const insRef = useRef<HTMLModElement | null>(null);
  const [status, setStatus] = useState<AdStatus>("unknown");
  const effectiveSlot = slot?.trim() || config?.homeInlineSlot || null;
  const eligible = Boolean(scriptReady && config && effectiveSlot && canRequest("inline"));

  useEffect(() => {
    const element = insRef.current;
    if (!eligible || !element) return;

    const reflectStatus = () => {
      const next = element.getAttribute("data-ad-status");
      if (next === "filled" || next === "unfilled") setStatus(next);
    };
    reflectStatus();

    const observer = new MutationObserver(reflectStatus);
    observer.observe(element, { attributes: true, attributeFilter: ["data-ad-status"] });
    return () => observer.disconnect();
  }, [eligible]);

  useEffect(() => {
    const element = insRef.current;
    if (!eligible || !element || element.dataset.madBuddyRequested === "true") return;

    element.dataset.madBuddyRequested = "true";
    try {
      (window.adsbygoogle = window.adsbygoogle || []).push({});
    } catch {
      // A blocked provider/network request is not a product error. Leave the
      // page intact and permit a fresh mount/navigation to try again later.
      element.dataset.madBuddyRequested = "false";
    }
  }, [eligible]);

  if (!eligible || !config || !effectiveSlot || status === "unfilled") return null;

  return (
    <div
      className="w-full min-w-0 overflow-hidden"
      data-mad-buddy-ad="inline"
      data-ad-placement={placement}
      aria-hidden="true"
    >
      <ins
        ref={insRef}
        className="adsbygoogle"
        style={{ display: "block" }}
        data-ad-client={config.clientId}
        data-ad-slot={effectiveSlot}
        data-ad-format="auto"
        data-full-width-responsive="true"
      />
    </div>
  );
}
