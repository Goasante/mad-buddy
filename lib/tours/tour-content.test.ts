import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PLAN_ENTITLEMENTS } from "@/lib/billing/entitlements";
import { planDisplayPrices } from "@/lib/billing/pricing";
import { cheapestPaidPrice, planPrice } from "@/lib/billing/upgrade-copy";
import { BOOLEAN_ENTITLEMENTS, NUMERIC_ENTITLEMENTS } from "@/lib/billing/entitlement-catalog";

const ROOT = join(__dirname, "..", "..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

/** Comments removed as spans, so JSX/SQL prose never satisfies a rule about code. */
const stripComments = (text: string) =>
  text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => {
      const trimmed = line.trimStart();
      return !trimmed.startsWith("//") && !trimmed.startsWith("--");
    })
    .join("\n");

const MIGRATION = read("supabase/migrations/20260801100000_tour_feature_vs_subscription.sql");
const SQL = stripComments(MIGRATION);
const RUNNER = read("components/tours/tour-runner.tsx");

/**
 * The step order the migration establishes, parsed from the reorder block rather
 * than restated, so this cannot drift from what actually ships.
 */
function seededOrder(): { key: string; position: number }[] {
  const block = SQL.slice(SQL.indexOf("set position = v.position + 1000"));
  const values = block.slice(block.indexOf("from (values"), block.indexOf(") as v(step_key, position)"));
  return [...values.matchAll(/\('([a-z-]+)',\s*(\d+)\)/g)]
    .map((match) => ({ key: match[1], position: Number(match[2]) }))
    .sort((a, b) => a.position - b.position);
}

/** Entitlement keys the migration assigns to a given step_key. */
function entitlementKeysFor(stepKey: string): string[] {
  const updates = [...SQL.matchAll(/set entitlement_keys = ([\s\S]*?);/g)];
  for (const update of updates) {
    const text = update[0];
    if (!text.includes(`step_key = '${stepKey}'`)) continue;
    return [...text.matchAll(/'([a-z_]+)'/g)].map((match) => match[1]).filter((key) => key !== stepKey);
  }
  return [];
}

// ---------------------------------------------------------------------------
// Features are not subscriptions
// ---------------------------------------------------------------------------

describe("feature steps never render a subscription comparison", () => {
  it("clears entitlement keys from every step except the subscription one", () => {
    // The bug: hangout and plans each carried entitlement_keys, and the runner
    // renders its plan comparison for ANY step that has them.
    expect(SQL).toContain("set entitlement_keys = '{}'");
    expect(SQL).toContain("where s.step_key <> 'plans-and-pricing'");
  });

  it("assigns entitlement keys to exactly ONE step", () => {
    const assignments = [...SQL.matchAll(/set entitlement_keys = array\[/g)];
    expect(assignments).toHaveLength(1);
    const target = SQL.slice(SQL.indexOf("set entitlement_keys = array["));
    expect(target).toContain("where s.step_key = 'plans-and-pricing'");
  });

  it("gives the Hangout step no entitlement keys", () => {
    expect(entitlementKeysFor("hangout")).toEqual([]);
  });

  it("gives the Plans FEATURE step no entitlement keys", () => {
    // Plans (the feature) and a subscription plan are different concepts; this
    // is the step where conflating them was most confusing.
    expect(entitlementKeysFor("plans")).toEqual([]);
  });

  it("is the runner's only trigger for the comparison, so clearing keys suffices", () => {
    expect(RUNNER).toContain("{stepEntitlements.length > 0 ? (");
    // No step_key or route is special-cased into showing plans.
    expect(RUNNER).not.toContain('stepKey === "plans"');
    expect(RUNNER).not.toContain('"plans-and-pricing"');
  });

  it("mentions no tier names in any feature step copy", () => {
    const copyBlock = SQL.slice(SQL.indexOf("set title = v.title"), SQL.indexOf(") as v(step_key, title, body)"));
    const entries = [...copyBlock.matchAll(/\('([a-z-]+)',\s*\n?\s*'((?:[^']|'')*)',\s*\n?\s*'((?:[^']|'')*)'\)/g)];
    expect(entries.length).toBeGreaterThanOrEqual(12);
    for (const [, key, title, body] of entries) {
      if (key === "plans-and-pricing") continue;
      const text = `${title} ${body}`;
      for (const tier of ["Buddy Plus", "Buddy Pro", "Free plan", "upgrade", "Upgrade"]) {
        expect(text, `${key} mentions "${tier}"`).not.toContain(tier);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Ordering
// ---------------------------------------------------------------------------

describe("step order tells a story", () => {
  const order = seededOrder();

  it("seeds exactly 13 sequenced steps", () => {
    expect(order).toHaveLength(13);
    expect(order.map((entry) => entry.position)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
  });

  it("puts Moments within the first five", () => {
    const moments = order.findIndex((entry) => entry.key === "moments");
    expect(moments).toBeGreaterThanOrEqual(0);
    expect(moments + 1).toBeLessThanOrEqual(5);
  });

  it("opens with welcome, proximity and privacy", () => {
    expect(order.slice(0, 3).map((entry) => entry.key)).toEqual(["welcome", "nearby-glow", "privacy"]);
  });

  it("ends with the subscription step then ready", () => {
    expect(order.at(-2)?.key).toBe("plans-and-pricing");
    expect(order.at(-1)?.key).toBe("ready");
  });

  it("vacates the retired step's slot BEFORE reordering", () => {
    // position is unique per version, so retiring after the reorder collided
    // with whichever step was assigned the vacated slot.
    expect(SQL.indexOf("step_key = 'personalization'")).toBeLessThan(
      SQL.indexOf("set position = v.position + 1000")
    );
  });

  it("retires rather than deletes, so historical analytics survive", () => {
    expect(SQL).toContain("requires_feature_flag = 'tour_step_retired'");
    expect(SQL.toLowerCase()).not.toContain("delete from public.tour_steps");
  });

  it("reorders with an offset, since position is unique per version", () => {
    expect(SQL).toContain("set position = v.position + 1000");
    expect(SQL).toContain("set position = s.position - 1000");
  });
});

// ---------------------------------------------------------------------------
// Targets
// ---------------------------------------------------------------------------

describe("tour targets are real", () => {
  it("targets Moments through a data-tour-id the app actually renders", () => {
    expect(SQL).toContain("'nav-moments'");
    // nav-* ids are derived from the route in the shell, so /moments must be a
    // registered nav destination for this target to exist.
    const shell = read("components/app-shell/app-shell.tsx");
    expect(shell).toContain("data-tour-id={`nav-${item.href.slice(1)}`}");
    expect(shell).toContain('href: "/moments"');
  });

  it("invents no target that the codebase cannot produce", () => {
    const targets = [...MIGRATION.matchAll(/'(nav-[a-z-]+|home-[a-z-]+|socialize-[a-z-]+)'/g)].map((m) => m[1]);
    const shell = read("components/app-shell/app-shell.tsx");
    const dashboard = read("components/dashboard/dashboard-page.tsx");
    const socialize = read("components/socialize/socialize-page.tsx");
    for (const target of new Set(targets)) {
      if (target.startsWith("nav-")) {
        // Derived id: the matching route must be in the nav list.
        expect(shell, target).toContain(`href: "/${target.slice(4)}"`);
      } else {
        const found = `${dashboard}${socialize}`.includes(`data-tour-id="${target}"`);
        expect(found, `${target} has no data-tour-id in the app`).toBe(true);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Subscription step
// ---------------------------------------------------------------------------

describe("the subscription step uses canonical data", () => {
  const keys = entitlementKeysFor("plans-and-pricing");

  it("names only real entitlement keys", () => {
    const known = new Set([
      ...NUMERIC_ENTITLEMENTS.map((entry) => entry.key as string),
      ...BOOLEAN_ENTITLEMENTS.map((entry) => entry.key as string)
    ]);
    expect(keys.length).toBeGreaterThanOrEqual(3);
    for (const key of keys) {
      expect(known.has(key), `${key} is not a real entitlement`).toBe(true);
    }
  });

  it("only compares entitlements that genuinely differ across tiers", () => {
    for (const key of keys) {
      const values = (["free", "buddy_plus", "buddy_pro"] as const).map(
        (plan) => PLAN_ENTITLEMENTS[plan][key as keyof (typeof PLAN_ENTITLEMENTS)["free"]]
      );
      expect(new Set(values).size, `${key} is identical on every plan`).toBeGreaterThan(1);
    }
  });

  it("makes Buddy Pro's Spotlight publishing visible", () => {
    expect(keys).toContain("public_moments");
    // And it really is a Pro-only capability.
    expect(PLAN_ENTITLEMENTS.free.public_moments).toBe(false);
    expect(PLAN_ENTITLEMENTS.buddy_plus.public_moments).toBe(false);
    expect(PLAN_ENTITLEMENTS.buddy_pro.public_moments).toBe(true);
  });

  it("labels that capability as Air, not by an old name", () => {
    const label = BOOLEAN_ENTITLEMENTS.find((entry) => entry.key === "public_moments")?.label ?? "";
    expect(label).toContain("Air");
    expect(label).not.toContain("Open Moments");
    expect(label).not.toContain("Spotlight");
  });

  it("seeds no value, price or tier figure into the tour data", () => {
    // The runner resolves every figure server-side from the registry.
    expect(MIGRATION).not.toMatch(/GHS\s?\d/);
    for (const key of keys) {
      const free = String(PLAN_ENTITLEMENTS.free[key as keyof (typeof PLAN_ENTITLEMENTS)["free"]]);
      if (free !== "true" && free !== "false") {
        expect(SQL, `${key} value ${free} is hardcoded`).not.toContain(`'${free}'`);
      }
    }
  });
});

describe("the subscription step is presented as a real comparison", () => {
  it("reads prices from the canonical display-price source", () => {
    expect(RUNNER).toContain("planPrice(tier.key)");
    expect(RUNNER).toContain("cheapestPaidPrice()");
    // Never a literal in the component.
    expect(RUNNER).not.toMatch(/GHS\s?\d/);
    expect(planPrice("buddy_pro")).toBe(planDisplayPrices.pro);
  });

  it("quotes the genuinely cheapest paid plan for 'as low as'", () => {
    expect(cheapestPaidPrice()).toBe(planDisplayPrices.plus);
    const copy = RUNNER.slice(RUNNER.indexOf("Upgrade from as low as"));
    expect(copy.slice(0, 120)).toContain("cheapestPaidPrice()");
  });

  it("replaces the vague promises with concrete ones", () => {
    for (const vague of ["The essentials.", "More ways to connect.", "The fullest experience."]) {
      expect(RUNNER, vague).not.toContain(vague);
    }
    expect(RUNNER).toContain("Everything you need to start");
    expect(RUNNER).toContain("More room to connect");
    expect(RUNNER).toContain("The full Mad Buddy experience");
  });

  it("keeps a clear current-plan indicator", () => {
    expect(RUNNER).toContain("Your plan");
    expect(RUNNER).toContain("const isCurrent = plan === tier.key;");
  });

  it("still teaches a Buddy Pro user what they have", () => {
    const tail = RUNNER.slice(RUNNER.indexOf('plan === "buddy_pro"'));
    expect(tail.slice(0, 300)).toContain("full Mad Buddy experience");
    expect(tail.slice(0, 300)).toContain("Air");
  });

  it("lays out full-width rows so feature names cannot truncate", () => {
    // Comments stripped: the block legitimately explains in prose that nothing
    // truncates, and matching that would test the comment rather than the class.
    const block = stripComments(
      RUNNER.slice(RUNNER.indexOf("{stepEntitlements.length > 0 ? ("), RUNNER.indexOf('<div className="mt-4 flex items-center'))
    );
    // The old four-column grid squeezed labels into "Max active han...".
    expect(block).not.toContain("grid-cols-[1.4fr_repeat(3,minmax(0,1fr))]");
    // No truncation class on the label element.
    expect(block).not.toMatch(/dt className="[^"]*truncate/);
    expect(block).toContain("flex items-baseline justify-between");
  });
});

// ---------------------------------------------------------------------------
// Copy rules
// ---------------------------------------------------------------------------

describe("tour copy rules", () => {
  it("uses no em dashes", () => {
    expect(MIGRATION).not.toContain("—");
  });

  it("updates steps in place so per-step analytics stay comparable", () => {
    expect(SQL).toMatch(/^update public\.tour_steps/m);
    // Only the genuinely new step is inserted.
    const inserts = [...SQL.matchAll(/insert into public\.tour_steps/g)];
    expect(inserts).toHaveLength(1);
    expect(SQL).toContain("'moments'");
  });

  it("keeps the new step insert idempotent", () => {
    expect(SQL).toContain("not exists (");
    expect(SQL).toContain("existing.step_key = 'moments'");
  });
});

// ---------------------------------------------------------------------------
// Nothing else regressed
// ---------------------------------------------------------------------------

describe("existing tour behaviour is preserved", () => {
  it("keeps skip, back, next, done and the progress indicator", () => {
    for (const control of ["Skip tour", "Back", 'isLast ? "Finish" : "Next"', 'role="progressbar"']) {
      expect(RUNNER, control).toContain(control);
    }
  });

  it("keeps route-aware targeting and admin preview", () => {
    expect(RUNNER).toContain('[data-tour-id="${step.targetId}"]');
    expect(RUNNER).toContain("Exit preview");
    expect(RUNNER).toContain("exitTourPreviewAction");
  });

  it("keeps the replay fix, which must not regress", () => {
    // Replay is a cookie session rendered by TourHost; the settings launcher
    // must still not mount the runner itself.
    expect(RUNNER).toContain("endTourReplayAction");
    expect(read("components/tours/walkthrough-replay.tsx")).not.toContain("TourRunner");
    expect(read("components/tours/tour-host.tsx")).toContain("decodeTourReplay");
  });

  it("keeps preview writing no progress", () => {
    expect(RUNNER).toContain("preview: preview || replay");
  });

  it("keeps the CTA from completing the tour", () => {
    const cta = RUNNER.slice(RUNNER.indexOf('recordStep(step.id, "tour_cta_clicked")'));
    const body = cta.slice(0, cta.indexOf("router.push(step.ctaHref"));
    expect(stripComments(body)).not.toContain("finish()");
  });
});
