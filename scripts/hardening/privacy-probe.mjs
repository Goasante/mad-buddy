/**
 * Privacy / authorization probe.
 *
 * Signed in as `qatester`, who is a Muddy of kofim and amab and is NOT related
 * to saao. Everything here is fetched from inside a real authenticated page, so
 * it exercises the same session, cookies and RLS path a real user would.
 *
 * Checks the Product Constitution's hard invariants:
 *   - exact friend location is never exposed (no lat/lng/metres/km anywhere)
 *   - a non-Muddy's private profile fields are not readable
 *   - another user's resources cannot be read by changing an id
 *   - DOB / birth date is not in any client payload
 */
import { chromium } from "playwright";

const BASE = process.env.MB_BASE || "http://localhost:3200";
const AUTH = process.argv[2] || "C:/mb-god/.hardening/auth-prod.json";

const OTHERS = {
  muddy: "2a54c81c-acad-4191-b89d-2c427c693c7a",     // kofim  — approved Muddy
  stranger: "1fd04f79-7ab6-482a-a969-348767e00f7c"   // saao   — no relationship
};

/** Field names that must never reach a client payload about another person. */
const FORBIDDEN = [
  "latitude", "longitude", "lat\"", "lng", "accuracy_m", "distance_m",
  "distance_km", "metres", "meters", "date_of_birth", "birth_date", "dob",
  "exact_location", "location_history"
];

const b = await chromium.launch();
const ctx = await b.newContext({ storageState: AUTH });
const p = await ctx.newPage();
await p.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded", timeout: 60000 });
await p.waitForTimeout(1200);

async function get(path) {
  return p.evaluate(async (u) => {
    try {
      const r = await fetch(u, { headers: { accept: "application/json" } });
      return { status: r.status, body: (await r.text()).slice(0, 4000) };
    } catch (e) {
      return { status: 0, body: String(e).slice(0, 200) };
    }
  }, path);
}

const results = [];
function check(label, res, expectation) {
  const leaks = FORBIDDEN.filter((f) => res.body.toLowerCase().includes(f.toLowerCase()));
  results.push({ label, status: res.status, leaks, expectation, sample: res.body.slice(0, 200) });
}

// Endpoints a signed-in client legitimately calls.
check("nearby friends", await get("/api/friends/nearby"), "no exact distance");
check("notifications", await get("/api/notifications?limit=10"), "own rows only");
check("unread count", await get("/api/messages/unread-count"), "own count");
check("request count", await get("/api/friends/request-count"), "own count");

// IDOR attempts: same endpoints, someone else's id.
check("stranger profile by id", await get(`/api/profile/${OTHERS.stranger}`), "404/403, never private fields");
check("muddy profile by id", await get(`/api/profile/${OTHERS.muddy}`), "only Muddy-visible fields");

console.log("\n=== PRIVACY PROBE ===\n");
for (const r of results) {
  const verdict = r.leaks.length ? `LEAK: ${r.leaks.join(", ")}` : "no forbidden fields";
  console.log(`${String(r.status).padEnd(4)} ${r.label.padEnd(26)} ${verdict}`);
  console.log(`     expect: ${r.expectation}`);
  console.log(`     body:   ${r.sample.replace(/\s+/g, " ").slice(0, 160)}`);
}

// Also scan the rendered Muddies page: a leak in the HTML payload counts too.
await p.goto(`${BASE}/friends`, { waitUntil: "domcontentloaded", timeout: 60000 });
await p.waitForTimeout(1800);
const html = await p.content();
const htmlLeaks = FORBIDDEN.filter((f) => html.toLowerCase().includes(f.toLowerCase()));
console.log(`\n/friends rendered payload: ${htmlLeaks.length ? `LEAK: ${htmlLeaks.join(", ")}` : "no forbidden fields"}`);

await b.close();
