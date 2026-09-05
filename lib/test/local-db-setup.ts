/**
 * Bootstrap for DB-backed (`*.local.test.ts`) suites.
 *
 * Loaded by vitest.local.config.ts as a setupFile, so every local suite gets
 * the same environment and the same safety guard rather than five hand-rolled
 * copies of the same loop. That duplication was not cosmetic: five suites
 * loaded `.env.local` themselves and one -- lib/linkr/live-journey -- did not,
 * so its `describe.skipIf(!isLocal)` saw an empty URL and silently skipped all
 * 17 of its tests while the run still reported green.
 *
 * A local suite that cannot reach a local database must FAIL, never skip: a
 * silent skip reads exactly like passing coverage that does not exist.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

/** Load `.env.local` without overriding anything already exported. */
function loadEnvLocal(): boolean {
  try {
    const raw = readFileSync(path.join(ROOT, ".env.local"), "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
      if (!process.env[key] && value) process.env[key] = value;
    }
    return true;
  } catch {
    return false;
  }
}

const loaded = loadEnvLocal();
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

/** Hostname only -- never the key, never the full URL with credentials. */
let host = "";
try { host = new URL(url).host; } catch { host = ""; }

const isLocal = /^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host);

/* These suites mutate a real database. Refusing loudly is the whole point:
   pointing them at a remote project would write test rows into it. */
if (!loaded) {
  throw new Error(
    "local DB tests require .env.local (not found). Run against the local Supabase stack."
  );
}
if (!url || !serviceRole) {
  throw new Error(
    "local DB tests require NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local."
  );
}
if (!isLocal) {
  throw new Error(
    `local DB tests refuse to run against a non-local target (host: ${host || "unparseable"}). ` +
    "Expected 127.0.0.1 or localhost."
  );
}

/* Belt and braces: a stray remote ref anywhere in the resolved config is a
   configuration mistake worth failing on, even if the host looked local. */
const PRODUCTION_REF = "cabkhxxnrybzhkbtoiiz";
const STAGING_REF = "ivaydmciwmjdjsrovbqb";
for (const [name, ref] of [["production", PRODUCTION_REF], ["staging", STAGING_REF]] as const) {
  if (url.includes(ref) || serviceRole.includes(ref)) {
    throw new Error(`local DB tests refuse to run: resolved config references the ${name} project.`);
  }
}
