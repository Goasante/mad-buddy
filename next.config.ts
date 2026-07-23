import type { NextConfig } from "next";

// The Content-Security-Policy is intentionally NOT set here. It needs a
// per-request nonce, which a static next.config header cannot provide, so it
// is generated and enforced in proxy.ts (the middleware). The remaining
// headers below are request-independent and stay here.

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // Profile and Moment images are submitted as multipart Server Actions.
      // Allow the 5 MB avatar source cap plus multipart metadata. Stored
      // avatars are always reduced to a compact 512 px WebP.
      bodySizeLimit: "6mb"
    }
  },
  turbopack: {
    root: process.cwd()
  },
  typedRoutes: true,
  async headers() {
    const productionOnlyHeaders = process.env.NODE_ENV === "production"
      ? [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }]
      : [];
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
          // Geolocation is the only sensitive capability this app uses, and
          // only from its own origin. Everything else is explicitly denied.
          {
            key: "Permissions-Policy",
            value: "geolocation=(self), camera=(), microphone=(), payment=(), usb=()"
          },
          // Content-Security-Policy is set per-request in proxy.ts (it needs a
          // nonce). It is now enforced, not Report-Only.
          ...productionOnlyHeaders
        ]
      },
      {
        // Authenticated/user-specific JSON must never be publicly cacheable
        // (audit §10). Route handlers that already set a stricter value
        // (e.g. /api/health's no-store) keep their own header.
        source: "/api/:path*",
        headers: [{ key: "Cache-Control", value: "private, no-store" }]
      }
    ];
  }
};

export default nextConfig;
