import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    root: process.cwd()
  },
  typedRoutes: true,
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // Geolocation is the only sensitive capability this app uses, and
          // only from its own origin. Everything else is explicitly denied.
          {
            key: "Permissions-Policy",
            value: "geolocation=(self), camera=(), microphone=(), payment=(), usb=()"
          }
        ]
      }
    ];
  }
};

export default nextConfig;
