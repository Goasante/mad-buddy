import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

// The mobile SPA reuses the web repo's Next-agnostic UI primitives
// (@/components/ui/*) and helpers (@/lib/utils) via this alias, so both apps
// share one design language. Only import framework-agnostic modules through it
// — never server-only code (services, admin client, etc.).
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "..")
    }
  },
  server: {
    port: 5173,
    host: true
  },
  build: {
    outDir: "dist"
  }
});
