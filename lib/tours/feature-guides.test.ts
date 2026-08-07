import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BOOLEAN_ENTITLEMENTS, NUMERIC_ENTITLEMENTS } from "@/lib/billing/entitlement-catalog";
import { MANAGED_FEATURES } from "@/lib/features/feature-flags";
import { isSafeInternalPath } from "@/lib/tours/admin-model";
import {
  FEATURE_GUIDES,
  FEATURE_GUIDE_GROUPS,
  findTarget,
  isKnownRoute,
  TOUR_TARGET_IDS
} from "@/lib/tours/registry";

const ROOT = join(__dirname, "..", "..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
const MIGRATION = read("supabase/migrations/20260801120000_feature_walkthroughs.sql")
  // Later migrations correct seeded steps in place. Applying them to the
  // parsed text keeps this suite describing the CURRENT database rather than
  // the day the seed shipped — the alternative is editing applied history.
  .replaceAll("'socialize-radar'", "'socialize-feed'")
  // 20260807200000 renames the Socialize guide copy to Linkr.
  .replaceAll("Socialize guide", "Linkr guide")
  .replaceAll("Opt in to Socialize", "Opt in to Linkr")
  .replaceAll("Socialize never grants", "Linkr never grants");

type SeededStep = {
  tourSlug: string;
  position: number;
  stepKey: string;
  title: string;
  body: string;
  targetId: string | null;
  route: string;
  featureFlag: string | null;
  entitlementKeys: string[];
};

function seededSteps(): SeededStep[] {
  const pattern = /\('([a-z-]+-guide)',\s*(\d+),\s*'([^']+)',\s*'([^']+)',\s*'([^']+)',\s*(?:'([^']+)'|null),\s*'([^']+)',\s*(?:'([^']+)'|null),\s*'\{([^}]*)\}'::text\[\]/g;
  return [...MIGRATION.matchAll(pattern)].map((match) => ({
    tourSlug: match[1],
    position: Number(match[2]),
    stepKey: match[3],
    title: match[4],
    body: match[5],
    targetId: match[6] ?? null,
    route: match[7],
    featureFlag: match[8] ?? null,
    entitlementKeys: match[9] ? match[9].split(",").filter(Boolean) : []
  }));
}

describe("feature guide catalogue", () => {
  const steps = seededSteps();

  it("ships one canonical guide for every current feature in the directory", () => {
    expect(FEATURE_GUIDES).toHaveLength(19);
    expect(new Set(FEATURE_GUIDES.map((guide) => guide.slug)).size).toBe(FEATURE_GUIDES.length);
    expect(new Set(FEATURE_GUIDE_GROUPS.map((group) => group.id)).size).toBe(FEATURE_GUIDE_GROUPS.length);
    for (const guide of FEATURE_GUIDES) {
      expect(MIGRATION, `${guide.slug} is not seeded`).toContain(`('${guide.slug}',`);
      expect(FEATURE_GUIDE_GROUPS.some((group) => group.id === guide.group)).toBe(true);
      expect(isKnownRoute(guide.entryRoute)).toBe(true);
      expect(isSafeInternalPath(guide.entryRoute)).toBe(true);
    }
  });

  it("keeps each investor demo concise", () => {
    expect(steps.length).toBeGreaterThan(70);
    for (const guide of FEATURE_GUIDES) {
      const guideSteps = steps.filter((step) => step.tourSlug === guide.slug);
      expect(guideSteps.length, guide.slug).toBeGreaterThanOrEqual(3);
      expect(guideSteps.length, guide.slug).toBeLessThanOrEqual(8);
      expect(guideSteps.map((step) => step.position)).toEqual(
        Array.from({ length: guideSteps.length }, (_, index) => index + 1)
      );
      for (const step of guideSteps) {
        expect(step.title.split(/\s+/).length, `${guide.slug}/${step.stepKey}`).toBeLessThanOrEqual(7);
        expect(step.body.length, `${guide.slug}/${step.stepKey}`).toBeLessThanOrEqual(190);
      }
    }
  });

  it("references only registered real targets and safe registered routes", () => {
    for (const step of steps) {
      if (step.targetId) expect(findTarget(step.targetId), step.targetId).toBeDefined();
      expect(isKnownRoute(step.route), step.route).toBe(true);
      expect(isSafeInternalPath(step.route), step.route).toBe(true);
    }
  });

  it("uses only canonical feature flags and entitlements", () => {
    const flags = new Set<string>(MANAGED_FEATURES.map((feature) => feature.key));
    const entitlements = new Set([
      ...NUMERIC_ENTITLEMENTS.map((entry) => entry.key as string),
      ...BOOLEAN_ENTITLEMENTS.map((entry) => entry.key as string)
    ]);
    for (const step of steps) {
      if (step.featureFlag) expect(flags.has(step.featureFlag), step.featureFlag).toBe(true);
      for (const key of step.entitlementKeys) expect(entitlements.has(key), key).toBe(true);
    }
  });

  it("hides every Air and Socialize step with its managed feature flag", () => {
    expect(steps.filter((step) => step.tourSlug === "air-guide").every((step) => step.featureFlag === "open_moments")).toBe(true);
    expect(steps.filter((step) => step.tourSlug === "socialize-guide").every((step) => step.featureFlag === "socialize")).toBe(true);
  });

  it("uses Air, ON AIR, and Tune In terminology without internal Spotlight wording", () => {
    const copy = steps
      .filter((step) => step.tourSlug === "air-guide")
      .map((step) => `${step.title} ${step.body}`)
      .join(" ");
    expect(copy).toContain("Air");
    expect(copy).toContain("ON AIR");
    expect(copy).toContain("Tune In");
    expect(copy).not.toContain("Spotlight");
    expect(copy).not.toContain("Open Moments");
  });

  it("keeps social Plans distinct from subscription tiers", () => {
    const planSteps = steps.filter((step) => step.tourSlug === "plans-guide");
    const copy = planSteps.map((step) => `${step.title} ${step.body}`).join(" ");
    expect(copy.toLowerCase()).toContain("social");
    expect(copy.toLowerCase()).toContain("not subscription tiers");
    expect(copy).not.toContain("Buddy Plus");
    expect(copy).not.toContain("Buddy Pro");
    expect(planSteps.every((step) => step.entitlementKeys.length === 0)).toBe(true);
  });

  it("states the accepted-watcher rule exactly for Safe Arrival", () => {
    const copy = steps
      .filter((step) => step.tourSlug === "safe-arrival-guide")
      .map((step) => step.body)
      .join(" ");
    expect(copy).toContain("Only contacts who accept count as watching");
    expect(copy).toContain("Pending and declined contacts do not");
  });

  it("contains no forbidden location precision or fabricated messaging features", () => {
    const consumerCopy = steps.map((step) => `${step.title} ${step.body}`).join(" ");
    expect(consumerCopy).not.toMatch(/\b(meters?|latitude|longitude|coordinates?|street address|map pins?)\b/i);
    const messages = steps.filter((step) => step.tourSlug === "messages-guide").map((step) => step.body).join(" ");
    expect(messages).not.toMatch(/typing indicator|read receipt|attachment|message reaction/i);
  });

  it("gates Air publishing and subscription comparison with canonical entitlement keys", () => {
    expect(
      steps.find((step) => step.tourSlug === "air-guide" && step.stepKey === "publish")?.entitlementKeys
    ).toEqual(["public_moments"]);
    expect(
      steps.find((step) => step.tourSlug === "subscription-guide" && step.stepKey === "tiers")?.entitlementKeys
    ).toEqual(["max_muddies", "custom_glow_styles", "public_moments"]);
    expect(MIGRATION).not.toMatch(/GHS\s?\d/);
  });
});

describe("feature guide runtime safeguards", () => {
  const controller = read("components/tours/tour-offer-controller.tsx");
  const runner = read("components/tours/tour-runner.tsx");
  const service = read("lib/tours/service.ts");

  it("waits for the interface and refuses to launch over a blocking modal", () => {
    expect(controller).toContain('querySelectorAll<HTMLElement>(\'[role="dialog"]\')');
    expect(controller).toContain('element.getAttribute("aria-modal") !== "false"');
    expect(controller).toContain("activeElement instanceof HTMLTextAreaElement");
    expect(controller).toContain('document.addEventListener("focusin", inspect)');
    expect(controller).toContain("350");
  });

  it("keeps one route-aware guide mounted until it resolves", () => {
    expect(controller).toContain("activeTourId");
    expect(controller).toContain("suppressedPathRef.current = pathname");
    expect(controller).toContain("suppressedPathRef.current !== pathname");
    expect(runner).toContain("router.push(step.route");
  });

  it("degrades a missing target to a usable explanation instead of trapping the user", () => {
    expect(runner).toContain("attempts < 12");
    expect(runner).toContain("setTargetMissing(true)");
    expect(runner).toContain("Skip tour");
    expect(runner).toContain('aria-label="Close walkthrough"');
  });

  it("offers only unresolved feature tours and resumes started progress", () => {
    expect(service).toContain('version.kind === "feature"');
    expect(service).toContain("progressStatus");
    expect(runner).toContain('record("started", step.stepKey)');
  });

  it("uses a mobile safe-area sheet and reduced-motion-aware scrolling", () => {
    expect(runner).toContain("env(safe-area-inset-bottom");
    expect(runner).toContain('behavior: reducedMotion ? "auto" : "smooth"');
    expect(runner).toContain("w-[calc(100%-1.5rem)]");
  });

  it("makes terminal progress monotonic at the database boundary", () => {
    expect(MIGRATION).toContain("record_user_tour_progress");
    expect(MIGRATION).toContain("where current_progress.status = 'started'");
    expect(MIGRATION).toContain("service role required");
    expect(service).toContain('admin.rpc("record_user_tour_progress"');
    expect(service).toContain("persistedStatus !== input.status");
  });

  it("keeps preview and replay out of ordinary progress writes", () => {
    expect(runner).toContain("preview: preview || replay");
    expect([...service.matchAll(/if \(input\.preview\) return true;/g)]).toHaveLength(2);
  });
});

describe("stable target contract", () => {
  it("uses central symbols in feature components instead of new literal ids", () => {
    for (const source of [
      "components/content/moments-page.tsx",
      "components/messages/messages-page.tsx",
      "components/hangout/hangout-mode-page.tsx",
      "components/socialize/socialize-page.tsx",
      "components/safety/safe-arrival-page.tsx",
      "components/plans/plans-page.tsx",
      "components/events/events-page.tsx",
      "components/profile/profile-page.tsx",
      "components/notifications/notifications-page.tsx",
      "components/settings/settings-page.tsx"
    ]) {
      const text = read(source);
      expect(text, source).toContain("TOUR_TARGET_IDS");
      expect(text, source).not.toMatch(/data-tour-id="(?!nav-)[a-z0-9-]+"/);
    }
  });

  it("registers the selected Air target used by contextual activation", () => {
    expect(findTarget(TOUR_TARGET_IDS.MOMENTS_AIR_TAB)?.route).toBe("/moments");
  });
});
