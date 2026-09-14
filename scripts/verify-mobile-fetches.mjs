#!/usr/bin/env node
/**
 * Fails when the mobile app can reach a RELATIVE, cookie-authenticated API call.
 *
 * WHY THIS EXISTS (PR #91 review): sharing Settings brought two controls with
 * it whose own imports looked harmless — DataExportButton and
 * LocationForGlowSetting — but which called `/api/...` relatively with
 * `credentials: "include"`. On Capacitor a relative path resolves against
 * https://localhost, the bundled asset origin that serves no API, and a cookie
 * is meaningless there because the session lives in a Bearer token. Export and
 * Location for Glow were both silently broken on Android.
 *
 * The existing gates could not catch this. verify-mobile-imports.mjs asks
 * "does any next/* module get in", and verify-mobile-bundle.mjs matches known
 * fingerprints in the built output. Neither asks whether reachable code makes a
 * request the native app cannot authenticate.
 *
 * So this walks the same graph and looks for the call itself. It is deliberately
 * about REACHABILITY, not about which file a call lives in: a shared component
 * is only safe if nothing it pulls in does this either.
 *
 * Usage:  node scripts/verify-mobile-fetches.mjs
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve, relative } from "node:path";

const ROOT = process.cwd();
const SRC = join(ROOT, "mobile", "src");
const EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs"];

/** Mirrors mobile/vite.config.ts. */
const ALIASES = [
  { find: /^@\/lib\/platform$/, to: join(ROOT, "lib/platform/index.mobile.ts") },
  { find: /^@\//, to: `${ROOT}/` }
];

function entryPoints() {
  const found = ["main.tsx", "App.tsx"].map((n) => join(SRC, n)).filter((p) => existsSync(p));
  if (found.length === 0) {
    console.error("FAIL: no mobile entry point found under mobile/src");
    process.exit(1);
  }
  return found;
}

function resolveFile(candidate) {
  if (existsSync(candidate)) {
    try {
      readFileSync(candidate);
      return candidate;
    } catch {
      // a directory
    }
  }
  for (const ext of EXTENSIONS) if (existsSync(candidate + ext)) return candidate + ext;
  for (const ext of EXTENSIONS) {
    const indexed = join(candidate, `index${ext}`);
    if (existsSync(indexed)) return indexed;
  }
  return null;
}

function applyAliases(specifier) {
  for (const { find, to } of ALIASES) if (find.test(specifier)) return specifier.replace(find, to);
  return specifier;
}

const visited = new Set();
const importedBy = new Map();
const violations = [];

function chainTo(file) {
  const chain = [file];
  let current = file;
  while (importedBy.has(current)) {
    current = importedBy.get(current);
    chain.push(current);
  }
  return chain.reverse().map((f) => relative(ROOT, f).split("\\").join("/"));
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

  /* A relative /api/ path passed to fetch or fetchWithTimeout. The native app
     must reach the API through its own client, which prefixes the configured
     origin and attaches the access token. */
  for (const match of source.matchAll(/(?:fetchWithTimeout|fetch)\(\s*["'`](\/api\/[^"'`]*)/g)) {
    violations.push({ path: match[1], chain: chainTo(file), kind: "relative /api/ request" });
  }

  /* Cookie auth is meaningless from https://localhost: the session is a Bearer
     token. Flagged separately because a cookie on an ABSOLUTE URL is just as
     broken, and would slip past the check above. */
  for (const match of source.matchAll(/credentials:\s*["']include["']/g)) {
    void match;
    violations.push({ path: 'credentials: "include"', chain: chainTo(file), kind: "cookie-authenticated request" });
  }

  for (const match of source.matchAll(/(?:^|\n)\s*(?:import|export)(?:\s+type)?[^\n]*?from\s*["']([^"']+)["']/g)) {
    const aliased = applyAliases(match[1]);
    const isPath = aliased.startsWith(".") || aliased.startsWith("/") || /^[A-Za-z]:[\\/]/.test(aliased);
    if (!isPath) continue;
    const target = resolveFile(aliased.startsWith(".") ? resolve(dirname(file), aliased) : aliased);
    if (!target || target.includes("node_modules")) continue;
    if (!importedBy.has(target)) importedBy.set(target, file);
    walk(target);
  }
}

for (const entry of entryPoints()) walk(entry);

if (violations.length > 0) {
  console.error(`FAIL: the mobile app can reach ${violations.length} request(s) it cannot authenticate.\n`);
  const seen = new Set();
  for (const v of violations) {
    const key = v.path + "|" + v.chain[v.chain.length - 1];
    if (seen.has(key)) continue;
    seen.add(key);
    console.error(`  ${v.kind}: ${v.path}`);
    console.error(`    ${v.chain.slice(-3).join("\n      -> ")}\n`);
  }
  console.error(
    "On Capacitor a relative path resolves against https://localhost -- the bundled\n" +
      "asset origin, which serves no API -- and a cookie is meaningless there because\n" +
      "the session is a Bearer token. Inject the request as a platform transport, or\n" +
      "render the control as unavailable on Android."
  );
  process.exit(1);
}

console.log(
  `Mobile request graph clean: ${visited.size} file(s) reachable, ` +
    "no relative or cookie-authenticated API calls."
);
