import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { corsHeaders } from "@/lib/api/cors";

/**
 * Every verb the API exposes must be reachable from the native app.
 *
 * TWO INDEPENDENT HALVES, and a gap in either is invisible server-side:
 *
 *   CORS allow-list   a verb missing here fails the PREFLIGHT, so the request
 *                     never leaves the device. Nothing reaches the server, so
 *                     no log, no 405, nothing to find.
 *   api client        a verb with no helper simply cannot be written. It fails
 *                     at the keyboard rather than at runtime, which is better,
 *                     but it still means an endpoint nobody can call.
 *
 * PR #93 review caught exactly this: /api/profile/interests was added with PUT
 * while the allow-list stopped at DELETE and the client had only get/post/del.
 * The endpoint was unreachable from Android in two separate ways.
 *
 * The expected set is DERIVED from the route files rather than hard-coded, so
 * adding a route with a new verb fails here until both halves catch up.
 */

const API_ROOT = join(process.cwd(), "app", "api");

/** Every HTTP verb any route handler exports. */
function exposedVerbs(dir: string, found = new Set<string>()): Set<string> {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      exposedVerbs(full, found);
      continue;
    }
    if (entry !== "route.ts") continue;
    const source = readFileSync(full, "utf8");
    for (const match of source.matchAll(/export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE)\b/g)) {
      found.add(match[1]);
    }
  }
  return found;
}

const verbs = exposedVerbs(API_ROOT);
const allowed = corsHeaders("https://localhost")["Access-Control-Allow-Methods"] ?? "";
const client = readFileSync("mobile/src/lib/api.ts", "utf8");

/** How each verb is spelled in the api client. */
const CLIENT_HELPER: Record<string, string> = {
  GET: "get:",
  POST: "post:",
  PUT: "put:",
  PATCH: "patch:",
  DELETE: "del:"
};

describe("the native app can reach every verb the API exposes", () => {
  it("finds the routes to check", () => {
    // Guards the crawl: a silent zero-match would make everything below
    // vacuously pass.
    expect(verbs.size).toBeGreaterThanOrEqual(4);
    expect(verbs.has("GET")).toBe(true);
    expect(verbs.has("POST")).toBe(true);
  });

  it.each([...verbs].sort())("%s is in the CORS allow-list", (verb) => {
    // Without this the preflight fails and the request never leaves the device.
    expect(allowed).toContain(verb);
  });

  it.each([...verbs].sort())("%s has a helper in the mobile api client", (verb) => {
    expect(client).toContain(CLIENT_HELPER[verb]);
  });

  it("always answers OPTIONS, which every preflight needs", () => {
    expect(allowed).toContain("OPTIONS");
  });
});

describe("the two halves agree with each other", () => {
  it("every allow-listed verb the client could send has a helper", () => {
    // OPTIONS is answered by the route, never sent by the client.
    for (const verb of allowed.split(",").map((v) => v.trim()).filter((v) => v !== "OPTIONS")) {
      expect(client, `${verb} is allow-listed but has no api client helper`).toContain(
        CLIENT_HELPER[verb]
      );
    }
  });

  it("PUT specifically, which PR #93 needed", () => {
    // /api/profile/interests replaces the whole selection rather than patching.
    expect(allowed).toContain("PUT");
    expect(client).toContain("put:");
  });

  it("PATCH specifically, which /api/profile/photos needed", () => {
    // Allow-listed since the mobile work began, but the client had no helper
    // until #93 -- so the photo visibility and reorder routes from #92 were
    // equally unreachable.
    expect(allowed).toContain("PATCH");
    expect(client).toContain("patch:");
  });
});
