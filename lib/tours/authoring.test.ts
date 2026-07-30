import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MANAGED_FEATURES } from "@/lib/features/feature-flags";
import { isSafeInternalPath } from "@/lib/tours/admin-model";
import { TOUR_ROUTES, TOUR_TARGETS, findRoute, findTarget, isKnownRoute, targetLabel } from "@/lib/tours/registry";

const ROOT = join(__dirname, "..", "..");

function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) sourceFiles(path, acc);
    else if (/\.tsx?$/.test(entry)) acc.push(path);
  }
  return acc;
}

describe("tour target registry is honest about the real UI", () => {
  // Every registry entry claims a data-tour-id exists in the app. If that drifts,
  // authoring offers a target that will silently never spotlight anything.
  const files = [...sourceFiles(join(ROOT, "components")), ...sourceFiles(join(ROOT, "app"))];
  const sources = files.map((path) => readFileSync(path, "utf8"));

  const rendered = new Set<string>();
  const templatePrefixes = new Set<string>();
  for (const text of sources) {
    for (const match of text.matchAll(/data-tour-id=["']([a-z0-9-]+)["']/g)) rendered.add(match[1]);
    // Route-derived ids, e.g. data-tour-id={`nav-${item.href.slice(1)}`}
    for (const match of text.matchAll(/data-tour-id=\{`([a-z-]+)-\$\{/g)) templatePrefixes.add(match[1]);
  }

  it("finds tour targets rendered in source", () => {
    // Guards the scraper itself: if this is empty the test below is vacuous.
    expect(rendered.size).toBeGreaterThan(0);
  });

  it("every registered target is actually rendered somewhere", () => {
    const missing = TOUR_TARGETS.filter((target) => {
      if (rendered.has(target.id)) return false;
      // Template-generated, e.g. "nav-friends" from the `nav-` prefix.
      return ![...templatePrefixes].some((prefix) => target.id.startsWith(`${prefix}-`));
    }).map((target) => target.id);
    expect(missing).toEqual([]);
  });

  it("registered target routes are all real picker routes", () => {
    const bad = TOUR_TARGETS.filter((target) => !isKnownRoute(target.route)).map((target) => target.id);
    expect(bad).toEqual([]);
  });

  it("has no duplicate target ids or route paths", () => {
    expect(new Set(TOUR_TARGETS.map((t) => t.id)).size).toBe(TOUR_TARGETS.length);
    expect(new Set(TOUR_ROUTES.map((r) => r.path)).size).toBe(TOUR_ROUTES.length);
  });

  it("every picker route is a safe internal path", () => {
    // The picker must never be able to introduce an external destination.
    for (const route of TOUR_ROUTES) {
      expect(isSafeInternalPath(route.path)).toBe(true);
    }
  });

  it("resolves friendly labels and falls back to the raw id", () => {
    expect(targetLabel("home-nearby")).toBe("Nearby Muddies");
    expect(targetLabel("not-registered")).toBe("not-registered");
    expect(targetLabel(null)).toBeNull();
    expect(findTarget("socialize-radar")?.route).toBe("/discover");
    expect(findRoute("/plans")?.label).toBe("Plans");
  });
});

describe("authoring is constrained to canonical catalogues", () => {
  const actions = readFileSync(join(ROOT, "app/(admin)/admin/tours/authoring-actions.ts"), "utf8");

  it("validates feature requirements against MANAGED_FEATURES, not free text", () => {
    expect(actions).toContain("KNOWN_FEATURE_FLAG_KEYS.includes");
    // Sanity-check the catalogue it validates against is the real one.
    expect(MANAGED_FEATURES.length).toBeGreaterThan(0);
  });

  it("validates entitlement keys against the canonical catalogue", () => {
    expect(actions).toContain("KNOWN_ENTITLEMENT_KEYS.includes");
  });

  it("validates routes and CTA destinations as internal paths", () => {
    expect(actions).toContain("isSafeInternalPath");
  });

  it("constrains media to the bundled tours directory", () => {
    expect(actions).toMatch(/\\\/tours\\\//);
  });

  it("enforces admin.tours.manage on every authoring action", () => {
    expect(actions).toContain('access.permissions.has("admin.tours.manage")');
    // One authorize() per exported action, so none can be reached unguarded.
    const exported = [...actions.matchAll(/export async function (\w+)/g)].map((m) => m[1]);
    const guarded = [...actions.matchAll(/await authorize\(\)/g)].length;
    expect(exported.length).toBeGreaterThan(0);
    expect(guarded).toBe(exported.length);
  });

  it("rate limits authoring mutations", () => {
    expect(actions).toContain("consumeRateLimit");
  });
});

describe("authoring protects published history", () => {
  const service = readFileSync(join(ROOT, "lib/tours/authoring-service.ts"), "utf8");

  it("gates every mutation behind a draft check", () => {
    // Published steps back recorded completions and analytics; editing them in
    // place would change what those numbers mean.
    const mutations = ["createStep", "updateStep", "deleteStep", "duplicateStep", "moveStep"];
    for (const name of mutations) {
      const body = service.slice(service.indexOf(`export async function ${name}`));
      const end = body.indexOf("\nexport async function", 1);
      const scoped = end > 0 ? body.slice(0, end) : body;
      expect(scoped).toContain("requireDraftVersion");
    }
  });

  it("refuses a mutation whose audit write failed", () => {
    // An unlogged privileged action is worse than a failed one.
    const refusals = [...service.matchAll(/if \(!logged\) return \{ ok: false/g)].length;
    const audits = [...service.matchAll(/recordAdminAuditEvent\(/g)].length;
    expect(audits).toBeGreaterThan(0);
    expect(refusals).toBe(audits);
  });

  it("never deletes user progress from an authoring path", () => {
    expect(service).not.toContain("user_tour_progress");
  });

  it("creates new tours as drafts only", () => {
    expect(service).toMatch(/status:\s*"draft"/);
    expect(service).not.toMatch(/status:\s*"published"/);
  });

  it("records the documented audit actions", () => {
    for (const action of [
      "tour.created",
      "tour.step_created",
      "tour.step_updated",
      "tour.step_deleted",
      "tour.steps_reordered"
    ]) {
      expect(service).toContain(action);
    }
  });
});

describe("draft preview cannot affect consumers", () => {
  it("preview short-circuits progress writes and analytics", () => {
    // Phase 1 contract, re-asserted here because authoring now exposes Preview
    // to admins far more often.
    const tourService = readFileSync(join(ROOT, "lib/tours/service.ts"), "utf8");
    expect(tourService).toMatch(/if \(input\.preview\) return true;/);
    const previewReturns = [...tourService.matchAll(/if \(input\.preview\) return true;/g)].length;
    // Both the progress writer and the step-event writer must bail out.
    expect(previewReturns).toBe(2);
  });
});
