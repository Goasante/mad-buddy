"use client";

import Script from "next/script";
import { usePathname } from "next/navigation";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
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

type RuntimeState = WebAdsFeatureState & { configured: boolean };
type RuntimeOverride = { signature: string; value: RuntimeState };

type WebAdsContextValue = {
  pathname: string;
  config: WebAdsConfiguration | null;
  scriptReady: boolean;
  canRequest: (format: AdFormat) => boolean;
};

const WebAdsContext = createContext<WebAdsContextValue | null>(null);
const RUNTIME_REFRESH_MS = 5 * 60 * 1000;

function safeOffState(): RuntimeState {
  return {
    adsEnabled: false,
    inlineEnabled: false,
    anchorEnabled: false,
    interstitialEnabled: false,
    adFree: true,
    configured: false
  };
}

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
  const [runtimeOverride, setRuntimeOverride] = useState<RuntimeOverride | null>(null);

  /*
   * Server props are the baseline truth after any server navigation/refresh.
   * A polled value is used only while it belongs to this exact baseline. When
   * the server supplies newer props, the signature changes and a stale client
   * override is ignored immediately — no effect-driven synchronisation needed.
   */
  const serverRuntime = useMemo<RuntimeState>(
    () => ({
      adsEnabled: features.adsEnabled,
      inlineEnabled: features.inlineEnabled,
      anchorEnabled: features.anchorEnabled,
      interstitialEnabled: features.interstitialEnabled,
      adFree: features.adFree,
      configured: config !== null
    }),
    [
      config,
      features.adFree,
      features.adsEnabled,
      features.anchorEnabled,
      features.inlineEnabled,
      features.interstitialEnabled
    ]
  );
  const runtimeSignature = useMemo(
    () =>
      [
        config?.clientId ?? "",
        config?.homeInlineSlot ?? "",
        serverRuntime.adsEnabled,
        serverRuntime.inlineEnabled,
        serverRuntime.anchorEnabled,
        serverRuntime.interstitialEnabled,
        serverRuntime.adFree,
        serverRuntime.configured
      ].join("|"),
    [config?.clientId, config?.homeInlineSlot, serverRuntime]
  );
  const runtime =
    runtimeOverride?.signature === runtimeSignature ? runtimeOverride.value : serverRuntime;

  // A Next layout can persist for a long PWA session. Refresh the two facts
  // that must take effect without requiring a restart:
  //   1. Admin's global/format kill switches;
  //   2. the member becoming ad-free (or their Access genuinely expiring).
  // Five minutes bounds a background session, while focus/visibility refreshes
  // catch a person returning from checkout or an admin intervention sooner.
  useEffect(() => {
    if (!config) return;

    let cancelled = false;

    const refresh = async () => {
      try {
        const response = await fetch("/api/ads/status", {
          method: "GET",
          cache: "no-store",
          credentials: "same-origin"
        });
        if (!response.ok) throw new Error("ad status unavailable");
        const next = (await response.json()) as Partial<RuntimeState>;
        if (cancelled) return;

        if (
          typeof next.adsEnabled !== "boolean" ||
          typeof next.inlineEnabled !== "boolean" ||
          typeof next.anchorEnabled !== "boolean" ||
          typeof next.interstitialEnabled !== "boolean" ||
          typeof next.adFree !== "boolean" ||
          typeof next.configured !== "boolean"
        ) {
          setRuntimeOverride({ signature: runtimeSignature, value: safeOffState() });
          return;
        }
        setRuntimeOverride({ signature: runtimeSignature, value: next as RuntimeState });
      } catch {
        if (!cancelled) {
          setRuntimeOverride({ signature: runtimeSignature, value: safeOffState() });
        }
      }
    };

    void refresh();
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, RUNTIME_REFRESH_MS);
    const onFocus = () => void refresh();
    const onVisibility = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [config, runtimeSignature]);

  const formatEnabled = useCallback(
    (format: AdFormat) => {
      if (format === "inline") return runtime.inlineEnabled;
      if (format === "anchor") return runtime.anchorEnabled;
      return runtime.interstitialEnabled;
    },
    [runtime.anchorEnabled, runtime.inlineEnabled, runtime.interstitialEnabled]
  );

  const canRequest = useCallback(
    (format: AdFormat) =>
      shouldRequestAd({
        pathname,
        format,
        adsEnabled: runtime.adsEnabled,
        formatEnabled: formatEnabled(format),
        adFree: runtime.adFree,
        configured: runtime.configured && config !== null
      }),
    [config, formatEnabled, pathname, runtime.adFree, runtime.adsEnabled, runtime.configured]
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
