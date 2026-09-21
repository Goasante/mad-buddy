"use client";

import Script from "next/script";
import { usePathname } from "next/navigation";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useState
} from "react";

import type { WebAdsConfiguration } from "@/lib/ads/config";
import { shouldRequestAd, type AdFormat } from "@/lib/ads/policy";

export type WebAdsFeatureState = {
  adsEnabled: boolean;
  inlineEnabled: boolean;
  anchorEnabled: boolean;
  interstitialEnabled: boolean;
  adFree: boolean;
};

type WebAdsContextValue = {
  pathname: string;
  config: WebAdsConfiguration | null;
  scriptReady: boolean;
  canRequest: (format: AdFormat) => boolean;
};

const WebAdsContext = createContext<WebAdsContextValue | null>(null);

export function WebAdsProvider({
  children,
  features,
  config,
  nonce
}: {
  children: ReactNode;
  features: WebAdsFeatureState;
  config: WebAdsConfiguration | null;
  /** Per-request CSP nonce minted by proxy.ts. */
  nonce?: string;
}) {
  const pathname = usePathname() || "/";
  const [scriptReady, setScriptReady] = useState(false);

  const formatEnabled = useCallback(
    (format: AdFormat) => {
      if (format === "inline") return features.inlineEnabled;
      if (format === "anchor") return features.anchorEnabled;
      return features.interstitialEnabled;
    },
    [features.anchorEnabled, features.inlineEnabled, features.interstitialEnabled]
  );

  const canRequest = useCallback(
    (format: AdFormat) =>
      shouldRequestAd({
        pathname,
        format,
        adsEnabled: features.adsEnabled,
        formatEnabled: formatEnabled(format),
        adFree: features.adFree,
        configured: config !== null
      }),
    [config, features.adFree, features.adsEnabled, formatEnabled, pathname]
  );

  /*
   * Initial PWA rollout is INLINE ONLY. Anchor and interstitial switches are
   * already modelled in Admin and policy, but the provider deliberately does
   * not let either one cause Google's site script to load by itself. That keeps
   * Google Auto ads from bypassing our per-format kill switches before we have
   * explicitly wired those formats.
   */
  const shouldLoadAdSense = canRequest("inline");

  const value = useMemo<WebAdsContextValue>(
    () => ({ pathname, config, scriptReady, canRequest }),
    [canRequest, config, pathname, scriptReady]
  );

  return (
    <WebAdsContext.Provider value={value}>
      {children}
      {shouldLoadAdSense && config && nonce ? (
        <Script
          id="mad-buddy-adsense"
          async
          nonce={nonce}
          strategy="afterInteractive"
          crossOrigin="anonymous"
          src={`https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(config.clientId)}`}
          onLoad={() => setScriptReady(true)}
          onReady={() => setScriptReady(true)}
          onError={() => setScriptReady(false)}
        />
      ) : null}
    </WebAdsContext.Provider>
  );
}

export function useWebAds(): WebAdsContextValue {
  const value = useContext(WebAdsContext);
  if (!value) {
    throw new Error("useWebAds must be used inside WebAdsProvider");
  }
  return value;
}
