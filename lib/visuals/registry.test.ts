import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { stripComments } from "@/lib/content/strip-comments";
import {
  allRegisteredAssets,
  planActivityArt,
  resolveSafeArrivalArtwork
} from "@/lib/visuals/registry";
import { PLAN_CATEGORIES, resolvePlanCover } from "@/lib/plans/plan-covers";

/**
 * The visual registry, and the boundaries it exists to hold.
 *
 * The supplied asset library disagreed with the product in several places: art
 * whose content contradicted its filename, fake app screens offered as
 * "empty states", trademarks in photographs, and category artwork for tables
 * that have no category column. These tests encode the decisions taken, so a
 * later change cannot quietly undo them.
 */

const PUBLIC_VISUALS = "public/visuals";

/** Everything actually shipped under /public/visuals. */
function shippedFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else out.push(full.replace(/\\/g, "/"));
    }
  };
  walk(PUBLIC_VISUALS);
  return out;
}

describe("only approved artwork reaches the runtime", () => {
  it("ships every registered asset, and nothing it does not register", () => {
    const registered = new Set(allRegisteredAssets().map((a) => `public${a.path}`));
    const shipped = new Set(shippedFiles());
    for (const path of registered) {
      expect(shipped.has(path), `registered but missing on disk: ${path}`).toBe(true);
    }
    for (const path of shipped) {
      expect(registered.has(path), `shipped but unregistered: ${path}`).toBe(true);
    }
  });

  it("never ships a rejected asset", () => {
    /* The six "empty state" images are fake app screens -- headings, fake list
     * rows, even a fake bottom navigation bar -- and every one is mislabelled
     * (empty-linkr depicts UpFor, empty-groups depicts Messages). Shipping any
     * of them would put a screenshot where an interface belongs. */
    const rejected = [
      "empty-events",
      "empty-plans",
      "empty-linkr",
      "empty-upfor",
      "empty-groups",
      "media-fallback-general",
      // Trademarks visible in the photograph.
      "activity-study",
      "activity-gym-fitness",
      "group-sports",
      "event-sports",
      // Off-brand: near-monochrome cobalt against a warm product.
      "home-ambient-evening",
      "home-ambient-night",
      /* Morning and afternoon passed review but have no consumer, so they were
       * removed from /public. A shipped file with no job is an invitation to
       * find it one. */
      "home/morning",
      "home/afternoon",
      // Waiting carries no artwork, so the attention image ships nowhere.
      "safe-arrival/attention",
      "safe-arrival/ready",
      // Registered but never rendered, so it does not ship.
      "hangout-general",
      // Depicts a security shield, not a streak.
      "journey-streak"
    ];
    const shipped = shippedFiles().join("\n");
    for (const name of rejected) {
      expect(shipped, `rejected asset was copied: ${name}`).not.toContain(name);
    }
  });

  it("keeps Event and Group category artwork out of the runtime", () => {
    /* Neither table has a category column. Wiring this art would have meant
     * inventing a taxonomy to justify the pictures, which is the asset library
     * dictating the data model. */
    const source = stripComments(readFileSync("lib/visuals/registry.ts", "utf8"));
    expect(source).not.toContain("event_fallback");
    expect(source).not.toContain("group_fallback");
    expect(shippedFiles().join("\n")).not.toMatch(/visuals\/(events|groups)\//);
  });
});

describe("Plan covers layer artwork in front of the CSS system", () => {
  it("a real uploaded cover always wins", () => {
    const cover = resolvePlanCover({ category: "coffee", coverImageUrl: "https://example.test/mine.jpg" });
    expect(cover.source).toBe("upload");
    expect(cover.imageUrl).toBe("https://example.test/mine.jpg");
  });

  it("a category with approved photography resolves to it", () => {
    const cover = resolvePlanCover({ category: "coffee", coverImageUrl: null });
    expect(cover.source).toBe("artwork");
    if (cover.source === "artwork") {
      expect(cover.imageUrl).toBe("/visuals/activities/coffee.jpg");
      // Intrinsic size travels with it, so a card reserves the box up front.
      expect(cover.width).toBeGreaterThan(0);
      expect(cover.height).toBeGreaterThan(0);
    }
  });

  it("a category whose art was REJECTED keeps its canonical CSS cover", () => {
    /* study and workout both had candidates, and both were refused for visible
     * trademarks. The CSS cover is the finished answer for them -- not a gap
     * waiting to be filled. */
    for (const category of ["study", "workout"] as const) {
      const cover = resolvePlanCover({ category, coverImageUrl: null });
      expect(cover.source, category).toBe("canonical");
      expect(cover.art, category).not.toBeNull();
    }
  });

  it("an unknown category falls back rather than throwing", () => {
    const cover = resolvePlanCover({ category: "definitely-not-a-category", coverImageUrl: null });
    expect(cover.source).toBe("fallback");
    expect(cover.art).not.toBeNull();
  });

  it("every category resolves to something renderable", () => {
    // A plan must always render, whatever its category.
    for (const category of PLAN_CATEGORIES) {
      const cover = resolvePlanCover({ category, coverImageUrl: null });
      expect(["artwork", "canonical"], category).toContain(cover.source);
    }
  });

  it("does not substitute any photograph for a rejected category", () => {
    /* Showing a picnic to somebody planning a workout is worse than showing
     * the workout gradient, so a rejected category resolves to null and falls
     * through to its CSS cover. There is deliberately no general master to
     * borrow: it had no consumer and was removed. */
    expect(planActivityArt("workout")).toBeNull();
    expect(planActivityArt("study")).toBeNull();
  });
});

describe("Safe Arrival artwork follows the real lifecycle", () => {
  it("covers the two states that carry artwork", () => {
    /* Keyed by the JourneyState key the UI already derives -- not by the
     * artwork filenames, which is what the first version of this registry got
     * wrong. */
    expect(resolveSafeArrivalArtwork("in_transit")?.path).toBe("/visuals/safe-arrival/active.jpg");
    expect(resolveSafeArrivalArtwork("arrived")?.path).toBe("/visuals/safe-arrival/complete.jpg");
  });

  it("gives WAITING no artwork, because the state is neutral by construction", () => {
    /* The tempting mapping is waiting -> "attention". The lifecycle documents
     * this state as neutral -- "hasn't confirmed yet", never "missing", never
     * an emergency -- and it asks nothing of the traveller, who may simply
     * have no signal. Heightened artwork would contradict that in the one
     * place where being wrong frightens somebody. */
    expect(resolveSafeArrivalArtwork("waiting")).toBeNull();
    /* `starting` has no artwork either, for a different reason: the setup
     * screen renders tone="transit", so a starting-specific image could never
     * reach a screen. Shipping it would have been a file with no job. */
    expect(resolveSafeArrivalArtwork("starting")).toBeNull();
  });

  it("gives endings no artwork", () => {
    // A closed session must not look like a live one.
    expect(resolveSafeArrivalArtwork("cancelled")).toBeNull();
    expect(resolveSafeArrivalArtwork("expired")).toBeNull();
  });

  it("returns null for an unknown key rather than throwing", () => {
    for (const value of [null, undefined, "", "nonsense", "attention", "ready"]) {
      expect(() => resolveSafeArrivalArtwork(value as never)).not.toThrow();
      expect(resolveSafeArrivalArtwork(value as never)).toBeNull();
    }
  });

  it("every JourneyState key resolves without throwing", () => {
    // The full canonical set, so a new state cannot silently break rendering.
    for (const key of ["starting", "in_transit", "waiting", "arrived", "cancelled", "expired"]) {
      expect(() => resolveSafeArrivalArtwork(key)).not.toThrow();
    }
  });

  it("describes no location, route or distance", () => {
    for (const asset of allRegisteredAssets()) {
      const text = asset.depicts.toLowerCase();
      for (const banned of ["map", "route", "gps", "pin", "distance", "coordinates", "tracking"]) {
        expect(text, `${asset.id} describes ${banned}`).not.toContain(banned);
      }
    }
  });
});

describe("generated artwork never becomes a person", () => {
  it("Linkr identity comes from Profile media, never the visual library", () => {
    /* A candidate card showing a stock model would be a lie about a real
     * person. Linkr reads the stranger-safe Profile projection and nothing
     * else. */
    const projection = stripComments(readFileSync("lib/linkr/media-projection.ts", "utf8"));
    expect(projection).not.toContain("/visuals/");
    const card = stripComments(readFileSync("components/linkr/candidate-card.tsx", "utf8"));
    expect(card).not.toContain("/visuals/");
  });

  it("Muddies surfaces never use library artwork as identity", () => {
    for (const file of ["components/friends/friends-page.tsx", "components/profile/profile-photo-carousel.tsx"]) {
      expect(stripComments(readFileSync(file, "utf8")), file).not.toContain("/visuals/");
    }
  });

  it("no registered asset is offered as an avatar", () => {
    for (const asset of allRegisteredAssets()) {
      expect(asset.role).not.toBe("avatar");
      expect(["plan_cover", "safe_arrival_state"]).toContain(asset.role);
    }
  });
});

describe("a missing asset degrades instead of crashing", () => {
  it("every resolver tolerates junk input", () => {
    for (const value of [null, undefined, "", "nonsense", "../../etc/passwd"]) {
      expect(() => planActivityArt(value as never)).not.toThrow();
      expect(() => resolveSafeArrivalArtwork(value)).not.toThrow();
    }
  });

  it("the Linkr orb slot still has no artwork, and says so", () => {
    /* The three orb assets remain a genuine missing dependency. The component
     * probes for them and reserves the same box either way, so their absence
     * is a placeholder rather than a broken layout -- and nothing unrelated
     * was substituted to make the slot look filled. */
    for (const name of ["orb-off", "orb-activate", "orb-empty"]) {
      expect(existsSync(`public/linkr/${name}.png`), `${name} unexpectedly present`).toBe(false);
    }
    const orb = stripComments(readFileSync("components/linkr/linkr-orb.tsx", "utf8"));
    expect(orb).not.toContain("/visuals/");
  });
});
