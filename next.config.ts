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
  // Server Actions load Sharp lazily, but its Linux binary and libvips must
  // still be copied into Vercel's traced function output. Without these
  // includes a production action can compile successfully and then fail at
  // runtime with ERR_DLOPEN_FAILED when it processes an avatar.
  outputFileTracingIncludes: {
    "/*": [
      "./node_modules/sharp/**/*",
      "./node_modules/@img/sharp-linux-x64/**/*",
      "./node_modules/@img/sharp-libvips-linux-x64/**/*"
    ]
  },
  typedRoutes: true,
  async headers() {
    const productionOnlyHeaders = process.env.NODE_ENV === "production"
      ? [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }]
      : [];
    return [
      {
        // A worker controls how an installed app launches. It must always be
        // revalidated so an old Home Screen installation can discover a new
        // deployment without being deleted and reinstalled.
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-store, no-cache, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" }
        ]
      },
      {
        source: "/manifest.webmanifest",
        headers: [
          { key: "Cache-Control", value: "no-cache, max-age=0, must-revalidate" }
        ]
      },
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
          // Geolocation, camera capture and voice recording are available only
          // to Mad Buddy's own top-level origin. Each is still requested only
          // after an explicit user action; framing, payment and USB stay denied.
          {
            key: "Permissions-Policy",
            value: "geolocation=(self), camera=(self), microphone=(self), payment=(), usb=()"
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
