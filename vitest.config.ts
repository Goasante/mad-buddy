import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts"]
  },
  resolve: {
    alias: {
      // "server-only" throws when imported outside a React Server context;
      // unit tests exercise pure logic, so stub it out.
      "server-only": path.resolve(__dirname, "lib/test/server-only-stub.ts"),
      "@": path.resolve(__dirname)
    }
  }
});
