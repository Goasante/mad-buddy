import { afterEach, describe, expect, it } from "vitest";
import { corsHeaders, isAllowedOrigin } from "@/lib/api/cors";

afterEach(() => {
  delete process.env.MOBILE_ALLOWED_ORIGIN;
});

describe("mobile CORS origins", () => {
  it("allows the Capacitor native webview origins", () => {
    expect(isAllowedOrigin("capacitor://localhost")).toBe(true);
    expect(isAllowedOrigin("http://localhost")).toBe(true);
    expect(isAllowedOrigin("https://localhost")).toBe(true);
    expect(isAllowedOrigin("ionic://localhost")).toBe(true);
  });

  it("does not allow arbitrary or absent origins", () => {
    expect(isAllowedOrigin("https://evil.example.com")).toBe(false);
    expect(isAllowedOrigin(null)).toBe(false);
    expect(isAllowedOrigin(undefined)).toBe(false);
    expect(isAllowedOrigin("")).toBe(false);
  });

  it("allows a single configured dev origin", () => {
    process.env.MOBILE_ALLOWED_ORIGIN = "http://192.168.1.10:5173";
    expect(isAllowedOrigin("http://192.168.1.10:5173")).toBe(true);
    expect(isAllowedOrigin("http://192.168.1.11:5173")).toBe(false);
  });

  it("emits no CORS headers for a same-origin/web request (unknown origin)", () => {
    // The web app is same-origin, so no CORS headers are added — responses stay
    // byte-for-byte identical to today.
    expect(corsHeaders(null)).toEqual({});
    expect(corsHeaders("https://mad-buddy.vercel.app")).toEqual({});
  });

  it("emits scoped, credentialed CORS headers for an allowed native origin", () => {
    const headers = corsHeaders("capacitor://localhost");
    expect(headers["Access-Control-Allow-Origin"]).toBe("capacitor://localhost");
    expect(headers["Access-Control-Allow-Credentials"]).toBe("true");
    expect(headers["Access-Control-Allow-Headers"]).toContain("authorization");
    expect(headers.Vary).toBe("Origin");
  });
});
