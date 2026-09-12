import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

// The mobile SPA reuses the web repo's components and helpers through the "@"
// alias, so both apps share one design language and one implementation.
//
// Never import server-only code through it (services, the admin client, and
// anything with `import "server-only"` at the top). That is not a style rule:
// a "use server" import drags the whole server graph into the browser bundle,
// which is what broke this build once already — see PR #84, where a single
// Server Action import in AudienceSelector pulled in 12 server-only modules
// including lib/supabase/admin, the service-role client.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      // ORDER MATTERS: the platform adapter must be matched BEFORE the general
      // "@" rule, or "@/lib/platform" would resolve to the web (Next) files
      // and the bundle would fail on `next/link`.
      //
      // This is the seam that makes components/** portable: shared code
      // imports "@/lib/platform" and gets Next on web, react-router here,
      // without either side knowing which it is.
      {
        find: /^@\/lib\/platform$/,
        replacement: path.resolve(__dirname, "../lib/platform/index.mobile.ts")
      },
      {
        find: "@",
        replacement: path.resolve(__dirname, "..")
      }
    ]
  },
  server: {
    port: 5173,
    host: true
  },
  build: {
    outDir: "dist"
  }
});
