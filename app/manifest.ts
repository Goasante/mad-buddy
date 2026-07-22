import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Mad Buddy",
    short_name: "Mad Buddy",
    description: "Know when approved friends are nearby without sharing exact locations.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#0b0f19",
    theme_color: "#0b0f19",
    orientation: "portrait-primary",
    categories: ["social", "lifestyle"],
    icons: [
      { src: "/icons/pwa/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/pwa/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/pwa/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" }
    ]
  };
}
