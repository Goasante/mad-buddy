import type { CapacitorConfig } from "@capacitor/cli";

// The app ships the bundled Vite SPA (mobile/dist), NOT a remote webview.
// There is intentionally no server.url: the native binary loads its own
// bundled assets and talks to Supabase + the web app's /api/* over HTTPS.
// (Google blocks OAuth inside embedded webviews, so a bundled client is also
// required for native Google sign-in in Phase 4/5.)
const config: CapacitorConfig = {
  appId: "com.madbuddy.app",
  appName: "Mad Buddy",
  webDir: "mobile/dist",
  android: {
    // Serve bundled assets over https://localhost so Secure-Context APIs
    // (crypto, geolocation) and Supabase cookies behave like production.
    allowMixedContent: false
  },
  server: {
    androidScheme: "https"
  }
};

export default config;
