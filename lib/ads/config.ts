export type WebAdsConfiguration = {
  /** Public AdSense client id, e.g. ca-pub-1234567890123456. */
  clientId: string;
  /** Responsive display-ad slot used by the Home inline placement. */
  homeInlineSlot: string;
};

export type WebAdsConfigurationResult =
  | { ok: true; value: WebAdsConfiguration }
  | { ok: false; missing: readonly ("ADSENSE_CLIENT_ID" | "ADSENSE_HOME_INLINE_SLOT")[] };

const ADSENSE_CLIENT_ID = /^ca-pub-\d{16}$/;
const ADSENSE_SLOT_ID = /^\d{5,20}$/;

/**
 * Read and validate only the public AdSense client id.
 *
 * Site ownership / ads.txt verification happens before a display ad unit has
 * necessarily been created, so it must not depend on ADSENSE_HOME_INLINE_SLOT.
 * Full ad serving still uses readWebAdsConfiguration below and therefore still
 * fails closed until both values are valid.
 */
export function readAdsenseClientId(env: Record<string, string | undefined>): string | null {
  const clientId = env.ADSENSE_CLIENT_ID?.trim() ?? "";
  return ADSENSE_CLIENT_ID.test(clientId) ? clientId : null;
}

/**
 * Read the PWA advertising configuration without ever inventing placeholder ids.
 *
 * AdSense ids are public identifiers, not secrets, but they remain server-owned
 * environment configuration so a build with no approved production values
 * fails closed to no advertising. The client receives them only after the
 * server has validated both values.
 */
export function readWebAdsConfiguration(
  env: Record<string, string | undefined>
): WebAdsConfigurationResult {
  const clientId = readAdsenseClientId(env) ?? "";
  const homeInlineSlot = env.ADSENSE_HOME_INLINE_SLOT?.trim() ?? "";
  const missing: Array<"ADSENSE_CLIENT_ID" | "ADSENSE_HOME_INLINE_SLOT"> = [];

  if (!clientId) missing.push("ADSENSE_CLIENT_ID");
  if (!ADSENSE_SLOT_ID.test(homeInlineSlot)) missing.push("ADSENSE_HOME_INLINE_SLOT");

  if (missing.length > 0) return { ok: false, missing };
  return { ok: true, value: { clientId, homeInlineSlot } };
}

export function webAdsConfigured(env: Record<string, string | undefined>): boolean {
  return readWebAdsConfiguration(env).ok;
}
