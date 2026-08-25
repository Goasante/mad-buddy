/**
 * RELEASE VERIFICATION -- what "deployed" is allowed to mean.
 *
 * A deployment was previously called successful because a git SHA matched a
 * Vercel deployment id. That is not the same claim as "the site is serving
 * this build", and it is nowhere near "the phone in the owner's hand is
 * running this build". Both gaps were real, and this closes the first two.
 *
 * The chain, each link proved rather than assumed:
 *
 *   1. the release worktree is clean and its HEAD is known
 *   2. origin/main is that same commit
 *   3. the LIVE DOMAIN reports that same commit from /api/version
 *   4. the live HTML references assets that actually load
 *   5. the service worker cannot pin a browser to an older build
 *
 * Link 6 -- the specific user-visible behaviour changed -- cannot be proved
 * from here. It requires a signed-in session on the live domain, so it is
 * reported as UNVERIFIED rather than quietly assumed. That honesty is the
 * point: this tool exists because a green report was trusted over a phone.
 *
 *   node scripts/hardening/verify-release.mjs [--url https://mad-buddy.com]
 */
import { execFileSync } from "node:child_process";

const args = process.argv.slice(2);
const urlArg = args.indexOf("--url");
const BASE = urlArg !== -1 ? args[urlArg + 1] : "https://mad-buddy.com";

const results = [];
const check = (n, ok, d) => {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"}  ${n}${d ? `\n        ${d}` : ""}`);
};

const git = (...a) => execFileSync("git", a, { encoding: "utf8" }).trim();

console.log(`Verifying release against ${BASE}\n`);

// ---- 1. the release worktree ------------------------------------------------
let head = null;
try {
  head = git("rev-parse", "HEAD");
  const dirty = git("status", "--porcelain");
  check("the release worktree is clean", dirty.length === 0,
    dirty ? `${dirty.split("\n").length} uncommitted file(s) -- a deploy from here is not reproducible` : head.slice(0, 7));
} catch (e) {
  check("the release worktree is readable", false, String(e).slice(0, 120));
}

// ---- 2. origin/main ---------------------------------------------------------
let remote = null;
try {
  remote = git("ls-remote", "origin", "main").split(/\s+/)[0];
  check("origin/main is the local HEAD", remote === head,
    `local ${head?.slice(0, 7)} vs origin ${remote?.slice(0, 7)}`);
} catch (e) {
  check("origin/main is readable", false, String(e).slice(0, 120));
}

// ---- 3. THE LIVE DOMAIN'S OWN ANSWER ---------------------------------------
// The link that was missing. Everything above can agree while the site serves
// something else entirely.
let live = null;
try {
  const res = await fetch(`${BASE}/api/version`, { cache: "no-store" });
  live = await res.json();
  check("the live domain answers /api/version", res.ok, `HTTP ${res.status}`);

  const cache = res.headers.get("cache-control") ?? "";
  check("the version answer is never cached", cache.includes("no-store"),
    `cache-control: ${cache || "(absent)"}`);

  if (live?.commit) {
    check("THE LIVE DOMAIN IS SERVING THIS COMMIT", live.commit === head,
      `live ${live.commitShort ?? live.commit?.slice(0, 7)} vs expected ${head?.slice(0, 7)}` +
      (live.commit === head ? "" : "\n        -> the site is NOT running the code you think it is. Fix the deploy before debugging product."));
    check("the live build is a production build",
      live.environment === "production", `environment=${live.environment}`);
  } else {
    check("the live domain reports its commit", false,
      `commit is ${JSON.stringify(live?.commit)} -- deploy the /api/version change first, then this link can be proved`);
  }
} catch (e) {
  check("the live domain is reachable", false, String(e).slice(0, 140));
}

// ---- 4. the assets the live HTML points at actually load --------------------
try {
  const html = await (await fetch(`${BASE}/login`, { cache: "no-store" })).text();
  const chunks = [...new Set([...html.matchAll(/\/_next\/static\/[^"']+?\.js/g)].map((m) => m[0]))];
  check("the live page references its own JS bundles", chunks.length > 0, `${chunks.length} chunk(s)`);

  let ok = 0;
  for (const c of chunks.slice(0, 5)) {
    const r = await fetch(`${BASE}${c}`, { cache: "no-store" });
    if (r.ok) ok++;
  }
  const sampled = Math.min(chunks.length, 5);
  check("those bundles actually load", ok === sampled, `${ok}/${sampled} sampled chunk(s) returned 200`);
} catch (e) {
  check("the live assets are fetchable", false, String(e).slice(0, 140));
}

// ---- 5. the service worker cannot pin an old build --------------------------
try {
  const sw = await (await fetch(`${BASE}/sw.js`, { cache: "no-store" })).text();
  const cachesAppAssets = /caches\.(put|add|addAll)\s*\(/.test(sw);
  check("the service worker does not cache application bundles", !cachesAppAssets,
    cachesAppAssets
      ? "it writes to a cache -- an installed PWA could keep serving an old build after a deploy"
      : "network-only: a new deploy is picked up on the next load");

  const claims = sw.includes("clients.claim");
  check("a new worker takes control rather than waiting forever", claims,
    claims ? "clients.claim() present" : "without clients.claim an old worker can stay in charge");
} catch (e) {
  check("the service worker is fetchable", false, String(e).slice(0, 140));
}

// ---- 6. the honest gap ------------------------------------------------------
console.log(`
UNVERIFIED FROM HERE -- requires a signed-in session on the live domain:
  the specific user-visible behaviour actually changed.

  This tool proves the site is serving the intended commit. It does NOT prove
  the fix works for a real user, and a release must not be called successful
  on the strength of the links above alone. Confirm on a phone.`);

const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} release checks passed`);
process.exit(results.every(Boolean) ? 0 : 1);
