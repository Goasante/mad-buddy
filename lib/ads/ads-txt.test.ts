import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/ads.txt/route";
import { readWebAdsConfiguration } from "@/lib/ads/config";

afterEach(() => vi.unstubAllEnvs());

describe("public AdSense verification", () => {
  it("serves the confirmed seller even before ad serving is configured", async () => {
    vi.stubEnv("ADSENSE_CLIENT_ID", "");
    vi.stubEnv("ADSENSE_HOME_INLINE_SLOT", "");
    const response = GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(await response.text()).toBe("google.com, pub-4573722222758398, DIRECT, f08c47fec0942fa0\n");
    expect(readWebAdsConfiguration(process.env).ok).toBe(false);
  });
});
