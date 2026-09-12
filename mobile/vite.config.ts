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
      // react-router-dom is a MOBILE-ONLY dependency, but the adapter's
      // .mobile files that import it live at the repo ROOT (they are shared
      // code, not mobile app code). Rollup resolves a bare import relative to
      // the importing file, so from ../lib/platform it looks in the root
      // node_modules and finds nothing.
      //
      // This mirrors the `paths` entry in mobile/tsconfig.json, keeping
      // TypeScript and Vite resolving the same package to the same place --
      // the agreement lib/platform/resolution-contract.test.ts exists to pin.
      {
        find: /^react-router-dom$/,
        replacement: path.resolve(__dirname, "node_modules/react-router-dom")
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
