import "server-only";

import { resolveAdEntitlementForUser } from "@/lib/access/ad-entitlement";
import { readWebAdsConfiguration } from "@/lib/ads/config";
import {
  ADS_ANCHOR_FLAG,
  ADS_ENABLED_FLAG,
  ADS_INLINE_FLAG,
  ADS_INTERSTITIAL_FLAG,
  loadGlobalFeatureFlags
} from "@/lib/features/feature-flags";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export type RuntimeAdStatus = {
  adsEnabled: boolean;
  inlineEnabled: boolean;
  anchorEnabled: boolean;
  interstitialEnabled: boolean;
  adFree: boolean;
  configured: boolean;
};

export const ADS_OFF_STATUS: RuntimeAdStatus = {
  adsEnabled: false,
  inlineEnabled: false,
  anchorEnabled: false,
  interstitialEnabled: false,
  // Unknown/failure must never show an ad to somebody who may have paid not to.
  adFree: true,
  configured: false
};

/**
 * One fresh, server-owned answer for a running PWA session.
 *
 * This exists because the authenticated Next layout is persistent during client
 * navigation. Admin must still be able to hit the advertising kill switch, and
 * a person who just bought Access must stop seeing Mad Buddy-controlled ads,
 * without requiring them to kill/reopen the PWA.
 *
 * Any failure returns ADS_OFF_STATUS. Revenue can recover on the next refresh;
 * accidentally serving an ad through an uncertain entitlement cannot be taken
 * back.
 */
export async function resolveRuntimeAdStatus(userId: string): Promise<RuntimeAdStatus> {
  try {
    const admin = createSupabaseAdminClient();
    const [enabled, entitlement] = await Promise.all([
      loadGlobalFeatureFlags(admin, [
        ADS_ENABLED_FLAG,
        ADS_INLINE_FLAG,
        ADS_ANCHOR_FLAG,
        ADS_INTERSTITIAL_FLAG
      ]),
      resolveAdEntitlementForUser(userId)
    ]);

    return {
      adsEnabled: enabled.has(ADS_ENABLED_FLAG),
      inlineEnabled: enabled.has(ADS_INLINE_FLAG),
      anchorEnabled: enabled.has(ADS_ANCHOR_FLAG),
      interstitialEnabled: enabled.has(ADS_INTERSTITIAL_FLAG),
      adFree: entitlement.adFree,
      configured: readWebAdsConfiguration(process.env).ok
    };
  } catch {
    return ADS_OFF_STATUS;
  }
}
