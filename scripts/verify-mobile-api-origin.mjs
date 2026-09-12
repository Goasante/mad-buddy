#!/usr/bin/env node
/**
 * Fails the build when the mobile app's API base URL does not serve /api/*
 * DIRECTLY -- that is, when it answers with a redirect.
 *
 * WHY THIS EXISTS (2026-09-12): the production domain moved to mad-buddy.com
 * and mad-buddy.vercel.app began answering /api/* with a 307 to the new host.
 * The shipped APK still pointed at the old host, so EVERY authenticated call
 * failed with net::ERR_INVALID_REDIRECT: a browser will not replay an
 * Authorization header across a cross-origin redirect. Notifications, plans,
 * nearby friends, hangouts and push registration were all dead in a build that
 * passed every test and both production builds.
 *
 * Nothing caught it because nothing checked. The bundle only has to contain a
 * URL -- it does not have to be a URL that works. This closes that gap.
 *
 * Run with --offline (or set MOBILE_API_ORIGIN_OFFLINE=1) to skip the network
 * probe and keep only the static checks, for builds without egress.
 */
import { readFileSync, existsSync } from "node:fs";

const ENV_FILES = ["mobile/.env.local", "mobile/.env"];
const PROBE_PATH = "/api/notifications?limit=1";

function readBaseUrl() {
  for (const file of ENV_FILES) {
    if (!existsSync(file)) continue;
    const line = readFileSync(file, "utf8")
      .split(/\r?\n/)
      .find((l) => l.trim().startsWith("VITE_API_BASE_URL="));
    if (line) return { value: line.split("=").slice(1).join("=").trim(), file };
  }
  return null;
}

const found = readBaseUrl();
if (!found) {
  console.error("FAIL: VITE_API_BASE_URL is not set in", ENV_FILES.join(" or "));
  process.exit(1);
}

const { value: baseUrl, file } = found;
let url;
try {
  url = new URL(baseUrl);
} catch {
  console.error(`FAIL: VITE_API_BASE_URL in ${file} is not a valid URL: ${baseUrl}`);
  process.exit(1);
}

if (url.protocol !== "https:") {
  console.error(`FAIL: VITE_API_BASE_URL must be https (got ${url.protocol}) -- the WebView blocks mixed content.`);
  process.exit(1);
}
if (baseUrl.endsWith("/")) {
  console.error(`FAIL: VITE_API_BASE_URL must not end with "/" (got ${baseUrl}).`);
  process.exit(1);
}

const offline = process.argv.includes("--offline") || process.env.MOBILE_API_ORIGIN_OFFLINE === "1";
if (offline) {
  console.log(`mobile API origin: ${baseUrl} (static checks only, probe skipped)`);
  process.exit(0);
}

const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), 20_000);
let response;
try {
  response = await fetch(`${baseUrl}${PROBE_PATH}`, {
    method: "GET",
    redirect: "manual",           // we want to SEE a redirect, not follow it
    headers: { origin: "https://localhost", accept: "application/json" },
    signal: controller.signal
  });
} catch (error) {
  clearTimeout(timer);
  console.error(`FAIL: could not reach ${baseUrl}${PROBE_PATH} -- ${error.message}`);
  process.exit(1);
}
clearTimeout(timer);

const location = response.headers.get("location");
if (response.status >= 300 && response.status < 400) {
  console.error(
    `FAIL: ${baseUrl} redirects /api/* (${response.status} -> ${location ?? "?"}).\n` +
    "      The app sends an Authorization header, which a browser will NOT replay\n" +
    "      across a cross-origin redirect; every authenticated call would fail with\n" +
    `      net::ERR_INVALID_REDIRECT. Point VITE_API_BASE_URL at ${location ? new URL(location).origin : "the canonical origin"}.`
  );
  process.exit(1);
}

// 401 is the expected, correct answer: the route exists and demands auth.
if (response.status !== 401) {
  console.error(
    `FAIL: ${baseUrl}${PROBE_PATH} answered ${response.status}; expected 401 from an\n` +
    "      authenticated route. A 404 means this origin does not serve the API."
  );
  process.exit(1);
}

console.log(`mobile API origin OK: ${baseUrl} serves /api/* directly (401, no redirect)`);
