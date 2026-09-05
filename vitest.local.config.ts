import path from "node:path";
import { defineConfig } from "vitest/config";

/**
 * DB-backed suites: one database, one worker, one file at a time.
 *
 * Six `*.local.test.ts` suites share a single local Supabase instance and the
 * same canonical fixtures -- USERS.A-D, CONVERSATIONS.direct/group, EVENT_ID --
 * and several of them write. They also share an acting identity that lives on
 * `globalThis` (lib/test/acting-user.ts), so anything interleaving inside one
 * process can act as the wrong person.
 *
 * Serial execution is therefore a correctness requirement here, not a
 * performance preference. It is expressed three ways because each covers a
 * different scheduler: one forked process, no parallel files, and no
 * concurrent tests within a file.
 *
 * The ordinary unit suite (vitest.config.ts) keeps full parallelism -- 7,900+
 * tests must not pay for six.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["lib/**/*.local.test.ts"],
    setupFiles: ["lib/test/local-db-setup.ts"],
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
    fileParallelism: false,
    sequence: { concurrent: false },
    // A shared database makes these slower than pure unit tests, and a
    // timeout here would read as a product failure.
    testTimeout: 60_000,
    hookTimeout: 60_000
  },
  resolve: {
    alias: {
      "server-only": path.resolve(__dirname, "lib/test/server-only-stub.ts"),
      "@": path.resolve(__dirname)
    }
  }
});
