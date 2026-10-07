import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { enableLocationForGlowOnWeb } from "@/lib/settings/web-client";

const fetchWithTimeout = vi.hoisted(() => vi.fn());
vi.mock("@/lib/network/resilience", () => ({ fetchWithTimeout }));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("Location for glow in Account Privacy", () => {
  it("connects the privacy screen to the existing permission control and web transport", () => {
    const page = readFileSync("components/settings/account-privacy-page.tsx", "utf8");
    expect(page).toContain('"use client"');
    expect(page).toContain("<LocationForGlowSetting");
    expect(page).toContain("onEnable={enableLocationForGlowOnWeb}");
    expect(page).toContain('role="status"');
    expect(page).toContain('href: "/settings/glow-visibility"');
    expect(readFileSync("app/(app)/settings/privacy/page.tsx", "utf8")).toContain("<AccountPrivacyPage");
  });

  it("does not request permission merely by opening settings", () => {
    const control = readFileSync("components/settings/location-for-glow-setting.tsx", "utf8");
    const effect = control.slice(control.indexOf("useEffect(() =>"), control.indexOf("function requestLocation()"));
    expect(effect).not.toContain("onEnable()");
    expect(effect).not.toContain("getCurrentPosition");
  });

  it("posts a user-requested position to the existing authenticated endpoint", async () => {
    vi.stubGlobal("window", { isSecureContext: true });
    vi.stubGlobal("navigator", {
      geolocation: {
        getCurrentPosition: vi.fn((success) => success({ coords: { latitude: 5.6, longitude: -0.2, accuracy: 20 } }))
      }
    });
    fetchWithTimeout.mockResolvedValue({ ok: true });
    await expect(enableLocationForGlowOnWeb()).resolves.toEqual({ ok: true });
    expect(fetchWithTimeout).toHaveBeenCalledWith(
      "/api/location/update",
      expect.objectContaining({ method: "POST", credentials: "include" }),
      15_000,
      "enable location for glow"
    );
  });

  it("explains blocked permissions without sending a location update", async () => {
    vi.stubGlobal("window", { isSecureContext: true });
    vi.stubGlobal("navigator", {
      geolocation: {
        getCurrentPosition: vi.fn((_success, failure) => failure({ code: 1, PERMISSION_DENIED: 1 }))
      }
    });
    const result = await enableLocationForGlowOnWeb();
    expect(result.ok).toBe(false);
    expect(result.message).toContain("Location is blocked");
    expect(fetchWithTimeout).not.toHaveBeenCalled();
  });

  it("reports network failures instead of claiming location was enabled", async () => {
    vi.stubGlobal("window", { isSecureContext: true });
    vi.stubGlobal("navigator", {
      geolocation: {
        getCurrentPosition: vi.fn((success) => success({ coords: { latitude: 5.6, longitude: -0.2, accuracy: 20 } }))
      }
    });
    fetchWithTimeout.mockRejectedValue(new Error("offline"));
    const result = await enableLocationForGlowOnWeb();
    expect(result.ok).toBe(false);
    expect(result.message).toContain("Check your connection");
  });
});
