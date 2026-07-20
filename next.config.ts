import type { NextConfig } from "next";
import { buildContentSecurityPolicy, supabaseOriginFromEnv } from "./lib/security/csp";

const contentSecurityPolicy = buildContentSecurityPolicy({
  supabaseOrigin: supabaseOriginFromEnv(process.env.NEXT_PUBLIC_SUPABASE_URL),
  mode: "report-only",
  allowDevEval: process.env.NODE_ENV === "development"
});

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
          // STAGE 2 of the CSP rollout (audit §13): Report-Only observes,
          // never blocks. Flip to "Content-Security-Policy" only after a
          // clean report window and the script-src nonce upgrade.
          {
            key: "Content-Security-Policy-Report-Only",
            value: contentSecurityPolicy
          },
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
