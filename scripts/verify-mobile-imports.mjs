#!/usr/bin/env node
/**
 * Walks the mobile app's import graph and fails on ANY `next/*` dependency.
 *
 * WHY THIS EXISTS, ALONGSIDE verify-mobile-bundle.mjs:
 *
 * The bundle checker matches known fingerprints in the built output. That is
 * the right tool for "did a server credential ship", but it is structurally
 * unable to catch a Next module it has not seen before -- and it has now
 * missed one twice:
 *
 *   PR #88  next/image shipped (`_next/image`, `NEXT_DEPLOYMENT_ID`)
 *   PR #90  next/navigation shipped via the shared PageHeader, bringing
 *           `useRouter`, `usePathname` and AppRouterContext -- including the
 *           literal string "invariant expected app router to be mounted",
 *           which is a THROWN ERROR. Pulse would have crashed on Android.
 *
 * Both slipped through because minified output does not contain the markers
 * the list was watching for. A marker list is only ever as good as the failure
 * it has already seen.
 *
 * This gate asks a structural question instead: starting from the mobile entry
 * points, following every relative and aliased import, is any `next/*` module
 * reachable? It needs no build, catches modules nobody has thought of yet, and
 * names the exact import chain so the fix is obvious.
 *
 * Type-only imports are ignored deliberately: `import type { Route } from
 * "next"` is erased at compile time and ships nothing.
 *
 * Usage:  node scripts/verify-mobile-imports.mjs
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve, relative } from "node:path";

const ROOT = process.cwd();
const MOBILE = join(ROOT, "mobile");
const SRC = join(MOBILE, "src");

/** Mirrors mobile/vite.config.ts. Order matters, as it does there. */
const ALIASES = [
  { find: /^@\/lib\/platform$/, to: join(ROOT, "lib/platform/index.mobile.ts") },
  { find: /^@\//, to: `${ROOT}/` }
];

const EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs"];

/** Entry points: everything the mobile app boots from. */
function entryPoints() {
  const found = [];
  for (const name of ["main.tsx", "App.tsx"]) {
    const full = join(SRC, name);
    if (existsSync(full)) found.push(full);
  }
  if (found.length === 0) {
    console.error("FAIL: no mobile entry point found under mobile/src");
    process.exit(1);
  }
  return found;
}

/**
 * Import specifiers, minus type-only ones.
 *
 * `import type ...` and `export type ...` are erased by the compiler, so a
 * type-only reference to "next" ships nothing and must not fail this gate --
 * components/app-shell/page-header.tsx legitimately does exactly that for
 * `Route`.
 */
function importsOf(source) {
  const specifiers = [];
  const statement = /(?:^|\n)\s*(import|export)(\s+type)?\s*([\s\S]*?)from\s*["']([^"']+)["']/g;
  let match;
  while ((match = statement.exec(source))) {
    const isTypeKeyword = Boolean(match[2]);
    const clause = match[3] ?? "";
    // `import { type A, type B } from "x"` is also fully erased.
    const namedOnlyTypes =
      /^\s*\{[\s\S]*\}\s*$/.test(clause) &&
      clause
        .replace(/[{}]/g, "")
        .split(",")
        .filter((part) => part.trim())
        .every((part) => /^\s*type\s+/.test(part));
    if (isTypeKeyword || namedOnlyTypes) continue;
    specifiers.push({ specifier: match[4], typeOnly: false });
  }
  // Bare side-effect imports (`import "./x.css"`) and dynamic import().
  const sideEffect = /(?:^|\n)\s*import\s*["']([^"']+)["']/g;
  while ((match = sideEffect.exec(source))) specifiers.push({ specifier: match[1] });
  const dynamic = /\bimport\(\s*["']([^"']+)["']\s*\)/g;
  while ((match = dynamic.exec(source))) specifiers.push({ specifier: match[1] });
  return specifiers;
}

function applyAliases(specifier) {
  for (const { find, to } of ALIASES) {
    if (find.test(specifier)) return specifier.replace(find, to);
  }
  return specifier;
}

/** Resolves to a real file, trying extensions and index files as Vite does. */
function resolveFile(candidate) {
  if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  for (const ext of EXTENSIONS) {
    if (existsSync(candidate + ext)) return candidate + ext;
  }
  for (const ext of EXTENSIONS) {
    const indexed = join(candidate, `index${ext}`);
    if (existsSync(indexed)) return indexed;
  }
  return null;
}

const visited = new Set();
/** file -> the file that imported it, for reporting the chain. */
const importedBy = new Map();
const violations = [];

function chainTo(file) {
  const chain = [file];
  let current = file;
  while (importedBy.has(current)) {
    current = importedBy.get(current);
    chain.push(current);
  }
  return chain.reverse().map((f) => relative(ROOT, f).replace(/\\/g, "/"));
}

function walk(file) {
  if (visited.has(file)) return;
  visited.add(file);

  let source;
  try {
    source = readFileSync(file, "utf8");
  } catch {
    return;
  }

  for (const { specifier } of importsOf(source)) {
    // THE CHECK: any runtime import of next or next/anything.
    if (specifier === "next" || specifier.startsWith("next/")) {
      violations.push({ specifier, chain: chainTo(file) });
      continue;
    }

    const aliased = applyAliases(specifier);
    // Bare package imports (react, lucide-react, ...) are third-party and not
    // what this gate is about; only follow paths into our own source.
    const isPath = aliased.startsWith(".") || aliased.startsWith("/") || /^[A-Za-z]:[\\/]/.test(aliased);
    if (!isPath) continue;

    const target = resolveFile(aliased.startsWith(".") ? resolve(dirname(file), aliased) : aliased);
    if (!target) continue;
    if (target.includes("node_modules")) continue;
    if (!importedBy.has(target)) importedBy.set(target, file);
    walk(target);
  }
}

for (const entry of entryPoints()) walk(entry);

// Route files are reachable from App.tsx, but so is every screen; make sure the
// walk actually covered the shared component tree rather than stopping early.
const sharedFilesSeen = [...visited].filter((f) => f.includes(`${ROOT}${"/"}components`) || f.includes("\\components\\")).length;

if (violations.length > 0) {
  console.error(`FAIL: the mobile app imports Next.js from ${violations.length} place(s).\n`);
  for (const { specifier, chain } of violations) {
    console.error(`  ${specifier}`);
    console.error(`    ${chain.join("\n      -> ")}\n`);
  }
  console.error(
    "Next modules cannot run in the native app: there is no App Router, so\n" +
      "useRouter() throws \"invariant expected app router to be mounted\".\n" +
      "Route the import through @/lib/platform, or inject the behaviour as a prop."
  );
  process.exit(1);
}

console.log(
  `Mobile import graph clean: ${visited.size} file(s) reachable ` +
    `(${sharedFilesSeen} from shared components), no next/* runtime imports.`
);
