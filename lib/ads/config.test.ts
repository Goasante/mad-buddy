import { describe, expect, it } from "vitest";

import { readAdsenseClientId, readWebAdsConfiguration, webAdsConfigured } from "@/lib/ads/config";

describe("web advertising configuration", () => {
  const valid = {
    ADSENSE_CLIENT_ID: "ca-pub-1234567890123456",
    ADSENSE_HOME_INLINE_SLOT: "1234567890"
  };

  it("accepts an approved-looking AdSense client and slot pair", () => {
    expect(readWebAdsConfiguration(valid)).toEqual({
      ok: true,
      value: {
        clientId: valid.ADSENSE_CLIENT_ID,
        homeInlineSlot: valid.ADSENSE_HOME_INLINE_SLOT
      }
    });
    expect(webAdsConfigured(valid)).toBe(true);
  });

  it("allows site verification with only a valid AdSense client id", () => {
    expect(readAdsenseClientId({ ADSENSE_CLIENT_ID: valid.ADSENSE_CLIENT_ID })).toBe(valid.ADSENSE_CLIENT_ID);
    expect(readWebAdsConfiguration({ ADSENSE_CLIENT_ID: valid.ADSENSE_CLIENT_ID }).ok).toBe(false);
  });

  it.each([
    ["missing client", { ADSENSE_HOME_INLINE_SLOT: valid.ADSENSE_HOME_INLINE_SLOT }],
    ["placeholder client", { ...valid, ADSENSE_CLIENT_ID: "ca-pub-xxxxxxxxxxxxxxxx" }],
    ["bad client shape", { ...valid, ADSENSE_CLIENT_ID: "pub-123" }]
  ])("rejects %s for client-only verification", (_name, env) => {
    expect(readAdsenseClientId(env)).toBeNull();
  });

  it.each([
    ["missing client", { ADSENSE_HOME_INLINE_SLOT: valid.ADSENSE_HOME_INLINE_SLOT }],
    ["placeholder client", { ...valid, ADSENSE_CLIENT_ID: "ca-pub-xxxxxxxxxxxxxxxx" }],
    ["bad client shape", { ...valid, ADSENSE_CLIENT_ID: "pub-123" }],
    ["missing slot", { ADSENSE_CLIENT_ID: valid.ADSENSE_CLIENT_ID }],
    ["placeholder slot", { ...valid, ADSENSE_HOME_INLINE_SLOT: "slot-home" }]
  ])("fails closed for full ad serving with %s", (_name, env) => {
    expect(readWebAdsConfiguration(env).ok).toBe(false);
    expect(webAdsConfigured(env)).toBe(false);
  });

  it("trims deployment whitespace before validation", () => {
    expect(
      readWebAdsConfiguration({
        ADSENSE_CLIENT_ID: `  ${valid.ADSENSE_CLIENT_ID}  `,
        ADSENSE_HOME_INLINE_SLOT: ` ${valid.ADSENSE_HOME_INLINE_SLOT} `
      })
    ).toEqual({
      ok: true,
      value: {
        clientId: valid.ADSENSE_CLIENT_ID,
        homeInlineSlot: valid.ADSENSE_HOME_INLINE_SLOT
      }
    });
    expect(readAdsenseClientId({ ADSENSE_CLIENT_ID: `  ${valid.ADSENSE_CLIENT_ID}  ` })).toBe(
      valid.ADSENSE_CLIENT_ID
    );
  });
});
