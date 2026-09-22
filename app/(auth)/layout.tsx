import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  robots: { index: false, follow: false }
};

/**
 * Keep Safari/PWA browser chrome and the bottom safe area visually continuous
 * with the auth surface. Without a route-specific theme colour, iOS paints the
 * area below the page with the app shell colour, which looks like an empty
 * strip underneath Login.
 */
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#FEFBF3" },
    { media: "(prefers-color-scheme: dark)", color: "#100807" }
  ]
};

export default function AuthLayout({ children }: { children: ReactNode }) {
  return children;
}
