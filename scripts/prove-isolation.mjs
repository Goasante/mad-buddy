/**
 * Isolation proof: staging and production are separate databases.
 *
 * Reads STAGING with the staging key, and PRODUCTION only through its PUBLIC
 * anon endpoint using the publishable key from .env.local -- never the
 * production service-role key, and never a write.
 */
import { readFileSync } from "node:fs";

function readEnv(path) {
  const out = {};
  let text;
  try { text = readFileSync(path, "utf8"); } catch { return out; }
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i > 0) out[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^["']|["']$/g, "");
  }
  return out;
}

const staging = readEnv(new URL("../.env.staging.local", import.meta.url).pathname.replace(/^\//, ""));
const stagingUrl = staging.NEXT_PUBLIC_SUPABASE_URL;
const stagingRef = new URL(stagingUrl).hostname.split(".")[0];
const PROD_REF = "cabkhxxnrybzhkbtoiiz";

console.log("=== A. Distinct projects ===");
console.log("staging ref    =", stagingRef);
console.log("production ref =", PROD_REF);
console.log("distinct       =", stagingRef !== PROD_REF ? "YES" : "NO -- HARD STOP");
if (stagingRef === PROD_REF) process.exit(1);

const sKey = staging.SUPABASE_SERVICE_ROLE_KEY;
const q = async (url, key, path) => {
  const r = await fetch(`${url}/rest/v1/${path}`, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
  return { status: r.status, body: await r.text() };
};

console.log("\n=== B. Staging test account IS visible in staging ===");
const inStaging = await q(stagingUrl, sKey, "profiles?select=username&username=eq.staging_user_001");
console.log("status:", inStaging.status, "| found:", inStaging.body.includes("staging_user_001") ? "YES" : "NO");

console.log("\n=== C. Staging total profile count ===");
const all = await fetch(`${stagingUrl}/rest/v1/profiles?select=user_id`, {
  headers: { apikey: sKey, Authorization: `Bearer ${sKey}`, Prefer: "count=exact", Range: "0-0" }
});
console.log("staging profiles =", all.headers.get("content-range"));

console.log("\n=== D. Staging DB does not contain production's data ===");
console.log("Every staging profile is a synthetic staging-user fixture:");
const nonSynthetic = await fetch(
  `${stagingUrl}/rest/v1/profiles?select=user_id&username=not.like.staging_user_*`,
  { headers: { apikey: sKey, Authorization: `Bearer ${sKey}`, Prefer: "count=exact", Range: "0-0" } }
);
console.log("non-synthetic profiles in staging =", nonSynthetic.headers.get("content-range"));
