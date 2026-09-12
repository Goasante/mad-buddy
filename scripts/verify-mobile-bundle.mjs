/**
 * Verifies the BUILT mobile bundle, not the source.
 *
 * Source assertions prove intent; this proves what actually shipped. It is the
 * same principle that corrected an earlier wrong conclusion about Android
 * permissions: for "what does the artifact really contain", read the artifact.
 *
 * Run after `cd mobile && npm run build`:
 *   node scripts/verify-mobile-bundle.mjs
 *
 * Exits non-zero on a violation so CI can gate on it.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const DIST = join(process.cwd(), "mobile", "dist");

/**
 * Markers that only appear if a Next or server-only module was bundled.
 * Deliberately specific: "next" alone would match innocent words, and a false
 * alarm here trains people to ignore the gate.
 */
const FORBIDDEN = [
  { pattern: /__next_app__/, why: "Next.js App Router runtime" },
  { pattern: /next\/dist\/client/, why: "Next.js client runtime" },
  { pattern: /createServerReference/, why: "a Server Action reference" },
  { pattern: /react-server-dom-webpack/, why: "the React Server Components transport" },
  { pattern: /SUPABASE_SERVICE_ROLE_KEY/, why: "the service-role key name" },
  { pattern: /createSupabaseAdminClient/, why: "the service-role Supabase client" }
];

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* walk(full);
    else yield full;
  }
}

let checked = 0;
const violations = [];

for (const file of walk(DIST)) {
  if (!/\.(js|mjs|cjs|html|css)$/.test(file)) continue;
  checked++;
  const source = readFileSync(file, "utf8");
  for (const { pattern, why } of FORBIDDEN) {
    if (pattern.test(source)) {
      violations.push(`${file.replace(process.cwd(), ".")}: contains ${why} (/${pattern.source}/)`);
    }
  }
}

if (checked === 0) {
  console.error("No bundle files found in mobile/dist. Build it first: cd mobile && npm run build");
  process.exit(1);
}

if (violations.length > 0) {
  console.error(`Mobile bundle contains code that must never reach a browser:\n`);
  for (const line of violations) console.error(`  - ${line}`);
  console.error(
    `\nThis usually means a shared component imported next/* or a "use server" ` +
      `module directly instead of going through @/lib/platform.`
  );
  process.exit(1);
}

console.log(`Mobile bundle clean: ${checked} file(s) checked, no Next.js or server-only code found.`);
