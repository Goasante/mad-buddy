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
/**
 * THIS LIST WAS TOO NARROW ONCE, AND THE GATE PASSED WHILE NEXT CODE SHIPPED.
 *
 * PR #88's artifact review found `_next/image`, `NEXT_DEPLOYMENT_ID` and
 * `imageConfigDefault` in the APK. None of the markers below caught it,
 * because `next/image` bundles its own runtime WITHOUT pulling in the App
 * Router or the client runtime this list was watching for. Two shared
 * components (brand-mark, brand-navigation-icon) imported next/image directly
 * instead of going through the platform adapter.
 *
 * The lesson generalises: a marker list is only as good as the failure it has
 * actually seen. When adding a Next feature to shared code, add its runtime
 * fingerprint here too -- and confirm the checker FAILS on a planted marker
 * rather than assuming it would.
 */
const FORBIDDEN = [
  // App Router / RSC runtimes.
  { pattern: /__next_app__/, why: "Next.js App Router runtime" },
  { pattern: /next\/dist\/client/, why: "Next.js client runtime" },
  { pattern: /createServerReference/, why: "a Server Action reference" },
  { pattern: /react-server-dom-webpack/, why: "the React Server Components transport" },

  // next/image. Confirmed present in a shipped APK before this was added.
  { pattern: /_next\/image/, why: "the next/image optimizer endpoint" },
  { pattern: /NEXT_DEPLOYMENT_ID/, why: "the next/image deployment-id hook" },
  { pattern: /imageConfigDefault/, why: "next/image's default image config" },

  // Other Next runtimes that would reach a bundle the same way.
  { pattern: /__NEXT_DATA__/, why: "the Next.js data payload" },
  { pattern: /next-route-announcer/, why: "the Next.js route announcer" },

  // Server-only credentials. These must never be near a browser bundle.
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
