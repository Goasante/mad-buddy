/**
 * R2 final integrated smoke: every primary surface, one instrumented pass.
 * Local only, harness only.
 */
import { chromium } from "playwright";
import { readFileSync, mkdirSync } from "node:fs";

const env = {};
for (const l of readFileSync("C:/mb-profile-perf-p1/.env.local", "utf8").split(/\r?\n/)) {
  const s = l.trim(); if (!s || s.startsWith("#")) continue;
  const i = s.indexOf("="); if (i > 0) env[s.slice(0, i)] = s.slice(i + 1);
}
if (!/127\.0\.0\.1|localhost/.test(env.NEXT_PUBLIC_SUPABASE_URL || "")) { console.error("HARD STOP"); process.exit(1); }
mkdirSync("C:/mb-profile-perf-p1/.shots", { recursive: true });

const VW = Number(process.env.VW || 393), VH = Number(process.env.VH || 852);
const THEME = process.env.THEME || "light";
const WHO = process.env.PERSONA || "qa";
const SHOTS = process.env.SHOTS === "1";

const errs = { page: [], console: [], net: [] };
let reloads = 0;

/* Payloads captured for the privacy sentinel. */
const payloads = [];

const SURFACES = [
  ["/dashboard", "Home"],
  ["/friends", "Muddies"],
  ["/messages", "Messages"],
  ["/linkr", "Linkr"],
  ["/hangout-mode", "UpFor"],
  ["/plans", "Plans"],
  ["/events", "Events"],
  ["/safe-arrival", "Safe Arrival"],
  ["/profile", "Profile"]
];

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({
  storageState: `C:/mb-profile-perf-p1/.d2/auth-${WHO}.json`,
  viewport: { width: VW, height: VH }, hasTouch: true, isMobile: true,
  baseURL: "http://127.0.0.1:3000", colorScheme: THEME, deviceScaleFactor: 2,
  permissions: ["geolocation"], geolocation: { latitude: 5.6037, longitude: -0.1870 }
});
const p = await ctx.newPage();
p.on("pageerror", (e) => errs.page.push(e.message.slice(0, 110)));
p.on("console", (m) => { if (m.type() === "error") errs.console.push(m.text().slice(0, 110)); });
p.on("requestfailed", (r) => errs.net.push({ u: r.url().slice(0, 60), e: r.failure()?.errorText }));
p.on("load", () => reloads++);
p.on("response", async (r) => {
  try {
    const ct = r.headers()["content-type"] || "";
    if (/json|text|rsc/.test(ct) && r.url().includes("127.0.0.1")) payloads.push((await r.text()).slice(0, 300000));
  } catch { /* body already consumed */ }
});

console.log(`=== SURFACES  ${VW}x${VH}  ${THEME}  persona=${WHO} ===`);
const results = [];
for (const [route, label] of SURFACES) {
  const before = reloads;
  await p.goto(route, { waitUntil: "domcontentloaded" });
  await p.waitForTimeout(3200);
  const info = await p.evaluate(() => ({
    doc: document.documentElement.scrollWidth,
    win: window.innerWidth,
    text: document.body.innerText.slice(0, 160).replace(/\s+/g, " "),
    heads: [...document.querySelectorAll("h1,h2,h3")].map((h) => h.textContent.trim().slice(0, 26)).slice(0, 4),
    nav: Boolean(document.querySelector("nav, [role='navigation']")),
    notFound: /404|could not be opened|page isn't here/i.test(document.body.innerText)
  }));
  const overflow = info.doc > info.win;
  results.push({ label, route, overflow, notFound: info.notFound });
  console.log(`${label.padEnd(13)} ${info.notFound ? "NOT FOUND" : "ok"}  overflow:${overflow ? "YES" : "no"}  ${info.doc}/${info.win}  nav:${info.nav}  | ${info.heads.join(" · ")}`);
  if (SHOTS) await p.screenshot({ path: `C:/mb-profile-perf-p1/.shots/smoke-${label.replace(/\s+/g, "")}-${VW}-${THEME}.png` });
  void before;
}

/* ---------- privacy sentinel over everything captured ---------- */
const all = payloads.join("\n");
console.log(`\n=== PRIVACY SENTINEL  (${payloads.length} payloads) ===`);
const probes = {
  "latitude key": /"latitude"\s*:|"lat"\s*:/,
  "longitude key": /"longitude"\s*:|"lng"\s*:|"lon"\s*:/,
  "raw coordinates": /"coordinates"\s*:|"geo"\s*:\s*\{/,
  "exact distance": /"distance_m|distanceMeters|"distance_meters"/,
  "location history": /location_history|route_history|breadcrumb|path_points/,
  "seeded lat 5.6037": /5\.6037/,
  "seeded lng -0.187": /-0\.187\d/
};
for (const [k, re] of Object.entries(probes)) console.log(`  ${k.padEnd(20)} ${re.test(all) ? "FOUND" : "absent"}`);

console.log("\n=== ERRORS ===");
console.log("page errors     :", errs.page.length, JSON.stringify(errs.page.slice(0, 3)));
console.log("console errors  :", errs.console.length, JSON.stringify(errs.console.slice(0, 3)));
const aborted = errs.net.filter((e) => /ABORTED/.test(e.e || "")).length;
const other = errs.net.filter((e) => !/ABORTED/.test(e.e || ""));
console.log("network failures:", errs.net.length, "| aborted(expected):", aborted, "| other:", JSON.stringify(other.slice(0, 3)));
console.log("document loads  :", reloads, `(${SURFACES.length} deliberate navigations)`);
const bad = results.filter((r) => r.notFound || r.overflow);
console.log("\nSURFACE PROBLEMS:", bad.length, JSON.stringify(bad));
await browser.close();
